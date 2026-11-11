import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const statuses = ["PRODUIT", "TRANSFORME", "EN_TRANSPORT", "STOCKE", "VENDU", "BLOQUE_RAPPELE"];

function request(path, options = {}) {
  const token = sessionStorage.getItem("tracechain-token");
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  });
}

function App() {
  const [user, setUser] = useState(() => JSON.parse(sessionStorage.getItem("tracechain-user") || "null"));
  const [lotId, setLotId] = useState("LOT-2026-0001");
  const [lot, setLot] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const showError = (operationError) => {
    setMessage("");
    setError(operationError.message);
  };

  const loadLot = async (event) => {
    event?.preventDefault();
    setError("");
    setMessage("");
    try {
      setLot(await request(`/public/lots/${encodeURIComponent(lotId.trim())}`));
    } catch (loadError) {
      setLot(null);
      showError(loadError);
    }
  };

  const onAction = async (successMessage, action) => {
    setError("");
    setMessage("");
    try {
      const result = await action();
      setMessage(`${successMessage} Transaction ${result.txHash || "submitted"} in block ${result.block ?? "pending"}.`);
      if (lotId) await loadLot();
    } catch (actionError) {
      showError(actionError);
    }
  };

  const logout = () => {
    sessionStorage.clear();
    setUser(null);
    setLot(null);
  };

  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">TRACECHAIN</p>
          <h1>Supply chain control room</h1>
        </div>
        <div className="account">
          <span>{user.email} · {user.role}</span>
          <button className="button secondary" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="content">
        <section className="hero">
          <div>
            <p className="eyebrow">OPERATIONS WORKSPACE</p>
            <h2>{roleTitles[user.role]}</h2>
            <p className="muted">{roleDescriptions[user.role]}</p>
          </div>
          <span className="status-pill">{user.role}</span>
        </section>
        {error && <div className="notice error">{error}</div>}
        {message && <div className="notice success">{message}</div>}
        <RoleWorkspace role={user.role} onAction={onAction} />
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PUBLIC VERIFICATION</p>
              <h2>Inspect a lot</h2>
            </div>
            <a className="text-link" href={`${API_URL}/docs`} target="_blank" rel="noreferrer">API docs →</a>
          </div>
          <form className="search" onSubmit={loadLot}>
            <input value={lotId} onChange={(event) => setLotId(event.target.value)} aria-label="Lot ID" placeholder="LOT-2026-0001" />
            <button className="button" type="submit">Verify lot</button>
          </form>
        </section>
        {lot && <LotCard lot={lot} />}
      </main>
    </div>
  );
}

const roleTitles = {
  PRODUCER: "Create and launch new lots.",
  PROCESSOR: "Transform inputs into traceable products.",
  TRANSPORTER: "Keep shipments and temperatures accountable.",
  WAREHOUSE: "Receive and monitor stored inventory.",
  RETAILER: "Receive stock and complete sales.",
  AUDITOR: "Review history and manage recalls.",
};

const roleDescriptions = {
  PRODUCER: "Create the first immutable record for a product lot.",
  PROCESSOR: "Consume owned input lots and preserve their lineage.",
  TRANSPORTER: "Record transport conditions while a lot is in transit.",
  WAREHOUSE: "Confirm reception and record storage conditions.",
  RETAILER: "Confirm incoming stock and mark it as sold.",
  AUDITOR: "Use the public timeline and recall unsafe unsold lots.",
};

function RoleWorkspace({ role, onAction }) {
  return <>{role === "PRODUCER" && <CreateLotForm onAction={onAction} />}{role === "PROCESSOR" && <TransformForm onAction={onAction} />}{role === "TRANSPORTER" && <TransportForm onAction={onAction} />}{role === "WAREHOUSE" && <StorageForm onAction={onAction} />}{role === "RETAILER" && <SellForm onAction={onAction} />}{role === "AUDITOR" && <RecallForm onAction={onAction} />}<TransferPanel onAction={onAction} /></>;
}

function CreateLotForm({ onAction }) {
  const [form, setForm] = useState({ lotId: "", productType: "", quantity: "", unit: "kg", origin: "", expiresAt: "" });
  const submit = (event) => {
    event.preventDefault();
    onAction("Lot created.", () => request("/lots", { method: "POST", body: JSON.stringify({ ...form, quantity: Number(form.quantity), expiresAt: form.expiresAt ? Math.floor(new Date(form.expiresAt).getTime() / 1000) : 0, dataHash: "", uri: "" }) }));
  };
  return <ActionPanel eyebrow="PRODUCER ACTION" title="Create a new lot" hint="This becomes the first event in the lot's permanent timeline." onSubmit={submit} button="Create lot">
    <Field label="Lot ID" value={form.lotId} placeholder="LOT-2026-0002" onChange={(value) => setForm({ ...form, lotId: value })} required />
    <Field label="Product type" value={form.productType} placeholder="Organic oranges" onChange={(value) => setForm({ ...form, productType: value })} required />
    <div className="form-grid"><Field label="Quantity" type="number" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} required /><Field label="Unit" value={form.unit} onChange={(value) => setForm({ ...form, unit: value })} required /></div>
    <Field label="Origin" value={form.origin} placeholder="Farm B - Tunisia" onChange={(value) => setForm({ ...form, origin: value })} required />
    <Field label="Expiry (optional)" type="date" value={form.expiresAt} onChange={(value) => setForm({ ...form, expiresAt: value })} />
  </ActionPanel>;
}

function TransformForm({ onAction }) {
  const [form, setForm] = useState({ inputIds: "", lotId: "", productType: "", quantity: "", unit: "kg", origin: "" });
  const submit = (event) => {
    event.preventDefault();
    onAction("Transformation recorded.", () => request("/lots/transform", { method: "POST", body: JSON.stringify({ ...form, inputIds: form.inputIds.split(",").map((id) => id.trim()).filter(Boolean), quantity: Number(form.quantity), expiresAt: 0, dataHash: "", uri: "" }) }));
  };
  return <ActionPanel eyebrow="PROCESSOR ACTION" title="Transform input lots" hint="Separate multiple parent lot IDs with commas. You must own every input lot." onSubmit={submit} button="Transform lots">
    <Field label="Input lot IDs" value={form.inputIds} placeholder="LOT-2026-0001, LOT-2026-0004" onChange={(value) => setForm({ ...form, inputIds: value })} required />
    <Field label="New lot ID" value={form.lotId} placeholder="LOT-2026-0003" onChange={(value) => setForm({ ...form, lotId: value })} required />
    <div className="form-grid"><Field label="Product type" value={form.productType} onChange={(value) => setForm({ ...form, productType: value })} required /><Field label="Quantity" type="number" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} required /></div>
    <div className="form-grid"><Field label="Unit" value={form.unit} onChange={(value) => setForm({ ...form, unit: value })} required /><Field label="Origin" value={form.origin} onChange={(value) => setForm({ ...form, origin: value })} required /></div>
  </ActionPanel>;
}

function TransportForm({ onAction }) {
  const [form, setForm] = useState({ lotId: "", temp: "" });
  return <ActionPanel eyebrow="TRANSPORTER ACTION" title="Log transport conditions" hint="Temperature is entered in Celsius and converted to the contract's x10 integer format." onSubmit={(event) => { event.preventDefault(); onAction("Transport event recorded.", () => request(`/lots/${encodeURIComponent(form.lotId)}/transport`, { method: "POST", body: JSON.stringify({ tempX10: form.temp === "" ? -32768 : Math.round(Number(form.temp) * 10), dataHash: "", uri: "" }) })); }} button="Record transport">
    <Field label="Lot ID" value={form.lotId} placeholder="LOT-2026-0001" onChange={(value) => setForm({ ...form, lotId: value })} required />
    <Field label="Temperature (°C)" type="number" step="0.1" value={form.temp} placeholder="4.2" onChange={(value) => setForm({ ...form, temp: value })} />
  </ActionPanel>;
}

function StorageForm({ onAction }) {
  const [form, setForm] = useState({ lotId: "", temp: "" });
  return <ActionPanel eyebrow="WAREHOUSE ACTION" title="Record storage conditions" hint="The lot must already be received by this warehouse." onSubmit={(event) => { event.preventDefault(); onAction("Storage event recorded.", () => request(`/lots/${encodeURIComponent(form.lotId)}/storage`, { method: "POST", body: JSON.stringify({ tempX10: form.temp === "" ? -32768 : Math.round(Number(form.temp) * 10), dataHash: "", uri: "" }) })); }} button="Record storage">
    <Field label="Lot ID" value={form.lotId} placeholder="LOT-2026-0001" onChange={(value) => setForm({ ...form, lotId: value })} required />
    <Field label="Temperature (°C)" type="number" step="0.1" value={form.temp} placeholder="4.2" onChange={(value) => setForm({ ...form, temp: value })} />
  </ActionPanel>;
}

function SellForm({ onAction }) {
  const [lotId, setLotId] = useState("");
  return <ActionPanel eyebrow="RETAILER ACTION" title="Mark a lot as sold" hint="Only lots in storage can be sold, and sold lots become terminal." onSubmit={(event) => { event.preventDefault(); onAction("Sale recorded.", () => request(`/lots/${encodeURIComponent(lotId)}/sell`, { method: "POST", body: JSON.stringify({}) })); }} button="Sell lot">
    <Field label="Lot ID" value={lotId} placeholder="LOT-2026-0001" onChange={setLotId} required />
  </ActionPanel>;
}

function RecallForm({ onAction }) {
  const [form, setForm] = useState({ lotId: "", reason: "" });
  return <ActionPanel eyebrow="AUDITOR ACTION" title="Recall a lot" hint="Recalls are permanent for normal supply-chain actions. Sold lots cannot be recalled." onSubmit={(event) => { event.preventDefault(); onAction("Recall recorded.", () => request(`/lots/${encodeURIComponent(form.lotId)}/recall`, { method: "POST", body: JSON.stringify({ reason: form.reason }) })); }} button="Recall lot">
    <Field label="Lot ID" value={form.lotId} placeholder="LOT-2026-0001" onChange={(value) => setForm({ ...form, lotId: value })} required />
    <Field label="Reason" value={form.reason} placeholder="Quality control failure" onChange={(value) => setForm({ ...form, reason: value })} required />
  </ActionPanel>;
}

function TransferPanel({ onAction }) {
  const [ship, setShip] = useState({ lotId: "", to: "", temp: "" });
  const [receive, setReceive] = useState({ lotId: "" });
  const [reject, setReject] = useState({ lotId: "", reason: "" });
  return <section className="panel action-panel"><div className="panel-heading"><div><p className="eyebrow">HANDOFF WORKFLOW</p><h2>Ship, receive, or reject</h2><p className="muted">The contract checks whether you own the lot or are its pending recipient.</p></div></div><div className="handoff-grid"><form onSubmit={(event) => { event.preventDefault(); onAction("Shipment started.", () => request(`/lots/${encodeURIComponent(ship.lotId)}/ship`, { method: "POST", body: JSON.stringify({ to: ship.to, tempX10: ship.temp === "" ? -32768 : Math.round(Number(ship.temp) * 10), dataHash: "", uri: "" }) })); }}><h3>Ship a lot</h3><Field label="Lot ID" value={ship.lotId} placeholder="LOT-2026-0001" onChange={(value) => setShip({ ...ship, lotId: value })} required /><Field label="Recipient wallet address" value={ship.to} placeholder="0x..." onChange={(value) => setShip({ ...ship, to: value })} required /><Field label="Temperature (°C)" type="number" step="0.1" value={ship.temp} onChange={(value) => setShip({ ...ship, temp: value })} /><button className="button" type="submit">Ship lot</button></form><form onSubmit={(event) => { event.preventDefault(); onAction("Reception confirmed.", () => request(`/lots/${encodeURIComponent(receive.lotId)}/receive`, { method: "POST", body: JSON.stringify({ dataHash: "", uri: "" }) })); }}><h3>Confirm reception</h3><Field label="Lot ID" value={receive.lotId} placeholder="LOT-2026-0001" onChange={(value) => setReceive({ lotId: value })} required /><button className="button" type="submit">Receive lot</button></form><form onSubmit={(event) => { event.preventDefault(); onAction("Reception rejected.", () => request(`/lots/${encodeURIComponent(reject.lotId)}/reject`, { method: "POST", body: JSON.stringify({ reason: reject.reason }) })); }}><h3>Reject reception</h3><Field label="Lot ID" value={reject.lotId} placeholder="LOT-2026-0001" onChange={(value) => setReject({ ...reject, lotId: value })} required /><Field label="Reason" value={reject.reason} placeholder="Damaged packaging" onChange={(value) => setReject({ ...reject, reason: value })} required /><button className="button secondary" type="submit">Reject lot</button></form></div></section>;
}

function ActionPanel({ eyebrow, title, hint, onSubmit, button, children }) {
  return <section className="panel action-panel"><div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="muted">{hint}</p></div></div><form onSubmit={onSubmit}><div className="form-grid">{children}</div><button className="button" type="submit">{button}</button></form></section>;
}

function Field({ label, value, onChange, type = "text", ...props }) {
  return <label>{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} {...props} /></label>;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("producer@example.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const result = await request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      sessionStorage.setItem("tracechain-token", result.token);
      sessionStorage.setItem("tracechain-user", JSON.stringify(result.user));
      onLogin(result.user);
    } catch (loginError) { setError(loginError.message); }
  };
  return <div className="login-shell"><form className="login-card" onSubmit={submit}><p className="eyebrow">TRACECHAIN</p><h1>Sign in to your network</h1><p className="muted">Choose an organization account to access its operations workspace.</p><Field label="Email" type="email" value={email} onChange={setEmail} required /><Field label="Password" type="password" value={password} onChange={setPassword} required />{error && <div className="notice error">{error}</div>}<button className="button" type="submit">Sign in</button><small className="muted">Test profiles are documented in TEST-LOGIN-PROFILES.md.</small></form></div>;
}

function LotCard({ lot }) {
  const status = statuses[Number(lot.status)] || "UNKNOWN";
  return <section className="panel lot-card"><div className="panel-heading"><div><p className="eyebrow">VERIFIED LOT</p><h2>{lot.lotId}</h2></div><span className={`status-pill status-${status}`}>{status}</span></div><div className="lot-meta"><div><span>Product</span><strong>{lot.productType}</strong></div><div><span>Origin</span><strong>{lot.origin}</strong></div><div><span>Owner</span><strong className="address">{lot.currentOwner}</strong></div></div><div className="timeline">{lot.timeline.map((event, index) => <div className="timeline-item" key={`${event.date}-${index}`}><span className="timeline-dot" /><div><strong>{event.type}</strong><time>{new Date(event.date).toLocaleString()}</time>{event.dataHash && <small>Document hash: {event.dataHash}</small>}</div></div>)}</div></section>;
}

createRoot(document.getElementById("root")).render(<App />);
