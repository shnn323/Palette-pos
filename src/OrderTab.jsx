import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient.js'

const fmt = (n) => new Intl.NumberFormat('ko-KR').format(Math.round(n)) + '원'

const CATEGORY_LABELS = {
  personal: { title: '개인 포토카드', caption: '1장당 가격' },
  group: { title: '포토카드 그룹 세트 + 피크키링', caption: '재고 한도 있음' },
  goods: { title: '굿즈', caption: '재고 한도 있음' },
  draw: { title: '뽑기판', caption: '재고 한도 있음' }
}

export default function OrderTab() {
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState({})
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [checkingOut, setCheckingOut] = useState(false)

  useEffect(() => {
    fetchProducts()

    const channel = supabase
      .channel('products-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        (payload) => applyChange(payload)
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function fetchProducts() {
    setLoading(true)
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true })
    if (error) {
      setMessage('상품을 불러오지 못했어: ' + error.message)
    } else {
      setProducts(data)
    }
    setLoading(false)
  }

  function applyChange(payload) {
    setProducts((prev) => {
      if (payload.eventType === 'UPDATE') {
        return prev.map((p) => (p.id === payload.new.id ? payload.new : p))
      }
      if (payload.eventType === 'INSERT') {
        if (prev.some((p) => p.id === payload.new.id)) return prev
        return [...prev, payload.new]
      }
      if (payload.eventType === 'DELETE') {
        return prev.filter((p) => p.id !== payload.old.id)
      }
      return prev
    })
  }

  // 장바구니 단계에서는 실제 재고를 건드리지 않음 (화면 표시용 잔여 수량만 계산).
  // 계산완료를 눌렀을 때만 진짜 재고를 차감해서, 고르다가 새로고침해도 재고가 안전함.
  function availableFor(product) {
    if (product.stock === null) return Infinity
    return product.stock - (cart[product.id] || 0)
  }

  function increment(product) {
    if (availableFor(product) <= 0) return
    setCart((c) => ({ ...c, [product.id]: (c[product.id] || 0) + 1 }))
    setMessage('')
  }

  function decrement(product) {
    const current = cart[product.id] || 0
    if (current <= 0) return
    setCart((c) => ({ ...c, [product.id]: current - 1 }))
  }

  async function checkout() {
    const entries = Object.entries(cart).filter(([, qty]) => qty > 0)
    if (entries.length === 0) return
    setCheckingOut(true)
    setMessage('')

    const failed = []
    const nextCart = { ...cart }

    for (const [productId, qty] of entries) {
      const product = products.find((p) => p.id === productId)
      if (!product) continue

      if (product.stock === null) {
        nextCart[productId] = 0
        continue
      }

      const { data, error } = await supabase.rpc('sell_product', {
        p_id: productId,
        p_qty: qty
      })

      if (error || data === false) {
        failed.push(product.name)
        // 실패한 항목은 장바구니에 그대로 남겨서 다시 시도할 수 있게 함
      } else {
        nextCart[productId] = 0
      }
    }

    setCart(nextCart)
    await fetchProducts()
    setCheckingOut(false)

    if (failed.length > 0) {
      setMessage(failed.join(', ') + ' 재고가 부족해서 처리 못했어. 수량을 줄이고 다시 시도해줘.')
    } else {
      setMessage('계산 완료. 다음 주문을 입력해줘.')
    }
  }

  const total = products.reduce(
    (sum, p) => sum + p.price * (cart[p.id] || 0),
    0
  )

  if (loading) return <p className="muted">불러오는 중...</p>

  const categories = [...new Set(products.map((p) => p.category))]
  const hasItemsInCart = Object.values(cart).some((qty) => qty > 0)

  return (
    <div>
      {categories.map((cat) => {
        const label = CATEGORY_LABELS[cat] || { title: cat, caption: '' }
        const items = products.filter((p) => p.category === cat)
        return (
          <div className="category-block" key={cat}>
            <div className="category-header">
              <h3>{label.title}</h3>
              <span className="category-caption">{label.caption}</span>
            </div>
            <div className="item-list">
              {items.map((p) => {
                const qty = cart[p.id] || 0
                const unlimited = p.stock === null
                const remaining = unlimited ? null : p.stock
                const canAddMore = availableFor(p) > 0
                return (
                  <div className="item-row" key={p.id}>
                    <div className="item-info">
                      <div className="item-name">{p.name}</div>
                      <div className="item-meta">
                        {fmt(p.price)}
                        {!unlimited && (
                          <span>
                            {' '}
                            · 남은 수량 {remaining}
                            {remaining <= 0 ? ' · 품절' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="item-controls">
                      <button
                        className="qty-button"
                        aria-label={p.name + ' 수량 줄이기'}
                        disabled={qty <= 0 || checkingOut}
                        onClick={() => decrement(p)}
                      >
                        -
                      </button>
                      <span className="qty-value">{qty}</span>
                      <button
                        className="qty-button"
                        aria-label={p.name + ' 수량 늘리기'}
                        disabled={!canAddMore || checkingOut}
                        onClick={() => increment(p)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      <div className="total-bar">
        <span>이번 주문 합계</span>
        <span className="total-value">{fmt(total)}</span>
      </div>

      <button
        className="checkout-button"
        onClick={checkout}
        disabled={!hasItemsInCart || checkingOut}
      >
        {checkingOut ? '처리 중...' : '계산완료'}
      </button>

      {message && <p className="status-message">{message}</p>}
    </div>
  )
}
