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

  // 화면은 즉시 반영하고(낙관적 업데이트), 서버 동기화는 뒤에서 처리.
  // 재고가 모자라서 서버가 거절하면 그때 되돌리고 알려줌.
  function increment(product) {
    const unlimited = product.stock === null
    if (!unlimited && product.stock <= 0) return

    setCart((c) => ({ ...c, [product.id]: (c[product.id] || 0) + 1 }))
    if (!unlimited) {
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, stock: p.stock - 1 } : p))
      )
    }
    setMessage('')

    if (!unlimited) {
      supabase.rpc('sell_product', { p_id: product.id, p_qty: 1 }).then(({ data, error }) => {
        if (error || data === false) {
          setCart((c) => ({ ...c, [product.id]: Math.max(0, (c[product.id] || 0) - 1) }))
          setMessage(product.name + '은 방금 품절됐어.')
          fetchProducts()
        }
      })
    }
  }

  function decrement(product) {
    const current = cart[product.id] || 0
    if (current <= 0) return
    const unlimited = product.stock === null

    setCart((c) => ({ ...c, [product.id]: current - 1 }))
    if (!unlimited) {
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, stock: p.stock + 1 } : p))
      )
      supabase.rpc('return_product', { p_id: product.id, p_qty: 1 }).then(({ error }) => {
        if (error) setMessage('재고 복구 실패: ' + error.message)
      })
    }
  }

  function checkout() {
    setCart({})
    setMessage('계산 완료. 다음 주문을 입력해줘.')
  }

  const total = products.reduce(
    (sum, p) => sum + p.price * (cart[p.id] || 0),
    0
  )

  if (loading) return <p className="muted">불러오는 중...</p>

  const categories = [...new Set(products.map((p) => p.category))]

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
                const outOfStock = !unlimited && p.stock <= 0
                return (
                  <div className="item-row" key={p.id}>
                    <div className="item-info">
                      <div className="item-name">{p.name}</div>
                      <div className="item-meta">
                        {fmt(p.price)}
                        {!unlimited && (
                          <span>
                            {' '}
                            · 남은 수량 {p.stock}
                            {outOfStock ? ' · 품절' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="item-controls">
                      <button
                        className="qty-button"
                        aria-label={p.name + ' 수량 줄이기'}
                        disabled={qty <= 0}
                        onClick={() => decrement(p)}
                      >
                        -
                      </button>
                      <span className="qty-value">{qty}</span>
                      <button
                        className="qty-button"
                        aria-label={p.name + ' 수량 늘리기'}
                        disabled={outOfStock}
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

      <button className="checkout-button" onClick={checkout}>
        계산완료
      </button>

      {message && <p className="status-message">{message}</p>}
    </div>
  )
}
