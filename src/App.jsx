import OrderTab from './OrderTab.jsx'

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-name">LOVE FNC 굿즈 주문</span>
        </div>
      </header>

      <main className="app-main">
        <OrderTab />
      </main>
    </div>
  )
}
