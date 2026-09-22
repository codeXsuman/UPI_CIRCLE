"use client";

import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type User = { id: string; name: string; upi: string; mobile: string; email: string; password?: string };
type Item = { id: number; name: string; amount: string };

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DRAFT_KEY = "upi-circle-draft-v3";

export default function Home() {
  const [page, setPage] = useState<"home" | "account" | "login" | "product" | "profile">("home");
  const [profile, setProfile] = useState<User | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [register, setRegister] = useState({ name: "", upi: "", mobile: "", email: "", password: "" });
  const [login, setLogin] = useState({ email: "", password: "" });
  const [items, setItems] = useState<Item[]>([{ id: 1, name: "", amount: "" }]);
  const [generated, setGenerated] = useState(false);
  const [toast, setToast] = useState("");
  const [shareTarget, setShareTarget] = useState<User | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const pop = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const loadMembers = async () => {
    try {
      const res = await fetch("/api/members", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setMembers(data.members || []);
    } catch {}
  };

  useEffect(() => {
    (async () => {
      let saved: any = null;
      try { saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null"); } catch {}
      if (saved?.page) setPage(saved.page);
      if (saved?.register) setRegister(saved.register);
      if (saved?.login) setLogin(saved.login);
      if (Array.isArray(saved?.items) && saved.items.length) setItems(saved.items);
      if (Array.isArray(saved?.selected)) setSelected(saved.selected);
      if (typeof saved?.generated === "boolean") setGenerated(saved.generated);

      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json();
        if (data.user) {
          const savedProfile = saved?.profileDraft;
          setProfile(savedProfile ? { ...data.user, ...savedProfile } : { ...data.user, password: "" });
          setPage(saved?.page || "product");
          await loadMembers();
        } else if (saved?.page === "product" || saved?.page === "profile") {
          setPage("home");
        }
      } catch {
        if (saved?.page === "product" || saved?.page === "profile") setPage("home");
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        page, profileDraft: profile, register, login, items, selected, generated
      }));
    } catch {}
  }, [hydrated, page, profile, register, login, items, selected, generated]);

  const registerAccount = async () => {
    if (Object.values(register).some(v => !v.trim())) return pop("Please complete all registration details");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(register)
      });
      const data = await res.json();
      if (!res.ok) return pop(data.error || "Unable to create account");
      setProfile({ ...data.user, password: "" });
      setRegister({ name: "", upi: "", mobile: "", email: "", password: "" });
      setPage("product");
      await loadMembers();
      pop("Account created successfully");
    } catch { pop("Unable to create account"); }
  };

  const loginAccount = async () => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(login)
      });
      const data = await res.json();
      if (!res.ok) return pop(data.error || "Unable to login");
      setProfile({ ...data.user, password: "" });
      setLogin({ email: "", password: "" });
      setPage("product");
      await loadMembers();
      pop("Logged in successfully");
    } catch { pop("Unable to login"); }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setProfile(null);
    setMembers([]);
    setSelected([]);
    setGenerated(false);
    setPage("home");
    try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
    pop("Logged out");
  };

  const updateProfile = async () => {
    if (!profile) return;
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile)
      });
      const data = await res.json();
      if (!res.ok) return pop(data.error || "Unable to update profile");
      setProfile({ ...data.user, password: "" });
      await loadMembers();
      pop("Profile updated successfully");
    } catch { pop("Unable to update profile"); }
  };

  const toggleMember = (id: string) =>
    setSelected(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);

  const updateItem = (id: number, key: "name" | "amount", value: string) => {
    setItems(old => old.map(item => item.id === id
      ? { ...item, [key]: key === "amount" ? value.replace(/[^0-9.]/g, "") : value }
      : item));
  };

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [items]
  );

  const paymentLink = useMemo(() => {
    if (!profile) return "";
    const note = items.filter(i => i.name.trim()).map(i => i.name.trim()).join(", ").slice(0, 60) || "UPI Circle bill";
    return "upi://pay?pa=" + encodeURIComponent(profile.upi)
      + "&pn=" + encodeURIComponent(profile.name)
      + "&am=" + total.toFixed(2)
      + "&cu=INR"
      + "&tn=" + encodeURIComponent(note);
  }, [profile, items, total]);

  const generateBill = async () => {
    if (!profile) return;
    if (!selected.length) return pop("Select at least one registered member");
    if (items.some(item => !item.name.trim() || Number(item.amount) <= 0)) return pop("Complete every bill item first");
    try {
      const res = await fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, recipientIds: selected })
      });
      const data = await res.json();
      if (!res.ok) return pop(data.error || "Unable to save bill");
      setGenerated(true);
      pop("Bill saved successfully");
    } catch { pop("Unable to save bill"); }
  };

  const shareText = (member: User) => {
    const itemLines = items
      .filter(i => i.name.trim())
      .map(i => "• " + i.name.trim() + " — ₹" + money(Number(i.amount) || 0))
      .join("\n");

    return [
      "UPI Circle Bill",
      "",
      "Hi " + member.name + ",",
      "Here is your bill:",
      "",
      "Billing items:",
      itemLines,
      "",
      "Total amount: ₹" + money(total),
      "Pay to: " + profile?.name,
      "UPI ID: " + profile?.upi,
      "",
      "Direct payment link:",
      paymentLink
    ].join("\n");
  };

  const shareBill = (member: User) => setShareTarget(member);

  const shareWithApps = async () => {
    if (!shareTarget) return;
    const text = shareText(shareTarget);
    if (navigator.share) {
      try {
        await navigator.share({
          title: "UPI Circle Bill — ₹" + money(total),
          text,
          url: paymentLink
        });
        setShareTarget(null);
        return;
      } catch (error: any) {
        if (error?.name === "AbortError") return;
      }
    }
    pop("Your browser does not provide the app share menu. Try WhatsApp or copy the link.");
  };

  const shareOnWhatsApp = () => {
    if (!shareTarget) return;
    const text = shareText(shareTarget);
    const whatsappUrl = "https://wa.me/?text=" + encodeURIComponent(text);
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    setShareTarget(null);
  };

  const copyBill = async () => {
    if (!shareTarget) return;
    try {
      await navigator.clipboard.writeText(shareText(shareTarget));
      setShareTarget(null);
      pop("Bill details and payment link copied");
    } catch { pop("Unable to copy bill"); }
  };

  const copyPaymentLink = async () => {
    try {
      await navigator.clipboard.writeText(paymentLink);
      pop("Payment link copied");
    } catch { pop("Unable to copy payment link"); }
  };

  const createNewBill = () => {
    setSelected([]);
    setItems([{ id: Date.now(), name: "", amount: "" }]);
    setGenerated(false);
    setShareTarget(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    pop("Ready to create a new bill");
  };

  const selectedMembers = members.filter(m => selected.includes(m.id));

  return (
    <main>
      <header>
        <div className="brand" onClick={() => setPage(profile ? "product" : "home")}>
          <b>U</b><strong>UPI<span>Circle</span></strong>
        </div>
        {profile ? (
          <button className="profile profileButton" onClick={() => setPage("profile")}>
            <span>{profile.name.charAt(0).toUpperCase()}</span><strong>{profile.name.split(" ")[0]}</strong>
          </button>
        ) : <div className="profilePlaceholder">Account</div>}
      </header>

      {page === "home" && (
        <section className="authLanding">
          <div className="authHero">
            <div className="eyebrow"><span>●</span> UPI CIRCLE <b>YOUR MONEY, TOGETHER</b></div>
            <h1>Split money.<br /><i>Together.</i></h1>
            <p>A simple space for friends to manage shared expenses, payments and circles.</p>
            <div className="authActions">
              <button className="primary authPrimary" onClick={() => setPage("account")}>Create a new account <span>→</span></button>
              <button className="secondary authSecondary" onClick={() => setPage("login")}>Login <span>↗</span></button>
            </div>
            <small className="authNote">Create your account once. Your circles and expenses stay connected.</small>
          </div>
          <div className="authVisual">
            <div className="authOrb orbOne" /><div className="authOrb orbTwo" />
            <div className="authPanel">
              <div className="authPanelTop"><span>UPI CIRCLE</span><b>●</b></div>
              <div className="authPanelLine" />
              <div className="authPanelBalance"><small>SHARED EXPENSES</small><strong>₹ 2,450.00</strong></div>
              <div className="authRows">
                <div><b>SC</b><span><strong>Shared coffee</strong><small>4 members</small></span><em>₹ 320</em></div>
                <div><b>TR</b><span><strong>Trip expenses</strong><small>6 members</small></span><em>₹ 1,840</em></div>
                <div><b>FD</b><span><strong>Food & dinner</strong><small>3 members</small></span><em>₹ 290</em></div>
              </div>
            </div>
          </div>
        </section>
      )}

      {page === "account" && (
        <section className="account">
          <div className="card accountCard">
            <div className="accountBadge">CREATE ACCOUNT</div>
            <label>UPI CIRCLE REGISTRATION</label>
            <h1>Create your account</h1>
            <p>Your registration draft is kept in this browser if you accidentally refresh.</p>
            <div className="formStack">
              <label>1. Enter your name<input value={register.name} placeholder="Your full name" onChange={e => setRegister({ ...register, name: e.target.value })} /></label>
              <label>2. Enter your UPI ID<input value={register.upi} placeholder="yourname@upi" onChange={e => setRegister({ ...register, upi: e.target.value })} /></label>
              <label>3. Enter your mobile number<input value={register.mobile} inputMode="numeric" maxLength={10} placeholder="10-digit mobile number" onChange={e => setRegister({ ...register, mobile: e.target.value.replace(/\D/g, "") })} /></label>
              <label>4. Enter email<input value={register.email} type="email" placeholder="you@example.com" onChange={e => setRegister({ ...register, email: e.target.value })} /></label>
              <label>5. Enter password<input value={register.password} type="password" placeholder="Create a password" onChange={e => setRegister({ ...register, password: e.target.value })} /></label>
            </div>
            <button className="primary accountSubmit" onClick={registerAccount}>Create account</button>
            <button className="wideBtn" onClick={() => setPage("home")}>Back to home</button>
          </div>
        </section>
      )}

      {page === "login" && (
        <section className="account">
          <div className="card accountCard">
            <div className="accountBadge">WELCOME BACK</div>
            <label>UPI CIRCLE LOGIN</label><h1>Login</h1>
            <p>Your login form also stays on this page after an accidental refresh.</p>
            <label>Email address<input value={login.email} type="email" placeholder="you@example.com" onChange={e => setLogin({ ...login, email: e.target.value })} /></label>
            <label>Password<input value={login.password} type="password" placeholder="Your password" onChange={e => setLogin({ ...login, password: e.target.value })} /></label>
            <button className="primary accountSubmit" onClick={loginAccount}>Login</button>
            <button className="wideBtn" onClick={() => setPage("home")}>Back to home</button>
          </div>
        </section>
      )}

      {page === "profile" && profile && (
        <section className="account profilePage">
          <div className="card accountCard">
            <div className="accountBadge">YOUR PROFILE</div>
            <label>UPI CIRCLE ACCOUNT</label><h1>Edit profile</h1>
            <p>Changes you type here remain in the current browser session until you save them.</p>
            <div className="formStack">
              <label>Name<input value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} /></label>
              <label>UPI ID<input value={profile.upi} onChange={e => setProfile({ ...profile, upi: e.target.value })} /></label>
              <label>Mobile number<input value={profile.mobile} maxLength={10} onChange={e => setProfile({ ...profile, mobile: e.target.value.replace(/\D/g, "") })} /></label>
              <label>Email<input value={profile.email} type="email" onChange={e => setProfile({ ...profile, email: e.target.value })} /></label>
              <label>Password<input value={profile.password || ""} type="password" placeholder="Leave blank to keep current" onChange={e => setProfile({ ...profile, password: e.target.value })} /></label>
            </div>
            <button className="primary accountSubmit" onClick={updateProfile}>Save changes</button>
            <button className="wideBtn" onClick={() => setPage("product")}>Back to product</button>
            <button className="wideBtn" onClick={logout}>Logout</button>
          </div>
        </section>
      )}

      {page === "product" && profile && (
        <section className="productPage">
          <div className="productHeader">
            <div><div className="eyebrow"><span>●</span> UPI CIRCLE <b>YOUR SPACE</b></div><h1>Create a bill</h1><p>Create a UPI bill for people who are registered on UPI Circle.</p></div>
            <button className="profileMini" onClick={() => setPage("profile")}><span>{profile.name.charAt(0).toUpperCase()}</span>{profile.name.split(" ")[0]}</button>
          </div>
          <div className="productGrid">
            <div className="productMain">
              <div className="card productCard">
                <div className="sectionTitle"><div><b>1</b><div><h2>Select members</h2><small>Choose registered members who need to pay.</small></div></div><span>{selected.length} selected</span></div>
                {members.length ? <div className="registeredList">{members.map(member => (
                  <button className={"registeredMember " + (selected.includes(member.id) ? "selected" : "")} key={member.id} onClick={() => toggleMember(member.id)}>
                    <span className="memberAvatar">{member.name.charAt(0).toUpperCase()}</span>
                    <span><strong>{member.name}</strong><small>{member.upi} · Registered</small></span>
                    <i>{selected.includes(member.id) ? "✓" : "+"}</i>
                  </button>
                ))}</div> : <div className="emptyMembers"><strong>No other registered members yet</strong><small>Create another account to make a member-to-member bill.</small></div>}
              </div>

              <div className="card productCard">
                <div className="sectionTitle"><div><b>2</b><div><h2>Bill details</h2><small>Add every item and its exact amount.</small></div></div></div>
                <div className="billItems">{items.map((item, index) => (
                  <div className="billItem" key={item.id}>
                    <span>{index + 1}</span>
                    <input value={item.name} placeholder="e.g. Tea" onChange={e => updateItem(item.id, "name", e.target.value)} />
                    <div className="itemAmount"><span>₹</span><input value={item.amount} inputMode="decimal" placeholder="0.00" onChange={e => updateItem(item.id, "amount", e.target.value)} /></div>
                    <button onClick={() => setItems(old => old.length === 1 ? old : old.filter(x => x.id !== item.id))} disabled={items.length === 1}>×</button>
                  </div>
                ))}</div>
                <button className="addItem" onClick={() => setItems(old => [...old, { id: Date.now(), name: "", amount: "" }])}>＋ Add another item</button>
                <div className="totalBar"><span>Total amount</span><strong>₹{money(total)}</strong></div>
                <button className="primary generateBtn" onClick={generateBill}>Generate UPI QR bill →</button>
              </div>
            </div>

            <aside className="productSide">
              <div className="card previewCard">
                <span className="live">● BILL PREVIEW</span>
                <h2>{items.filter(i => i.name.trim()).map(i => i.name).join(" + ") || "Your bill items"}</h2>
                <div className="previewTotal">₹{money(total)}</div>
                <small>Paid to</small><strong>{profile.name}</strong><span>{profile.upi}</span>
                {selectedMembers.length > 0 && <div className="selectedPayers"><small>Bill for</small>{selectedMembers.map(m => <div key={m.id}><span>{m.name}</span><b>₹{money(total)}</b></div>)}</div>}
                <div className="secureNote">✓ QR bill uses the registered UPI ID of the person who will receive payment.</div>
              </div>
            </aside>
          </div>

          {generated && <div className="generatedBills">
            <div className="generatedHead"><div><span className="live">● GENERATED</span><h2>UPI bills ready to share</h2><p>Each selected member has a personal QR bill with item details and a direct UPI payment link.</p></div><div className="generatedActions"><button onClick={() => setGenerated(false)}>Edit bill</button><button className="primary newBillBtn" onClick={createNewBill}>＋ Create new bill</button></div></div>
            <div className="qrBillGrid">{selectedMembers.map(member => (
              <div className="card qrBill" key={member.id}>
                <div className="qrBillTop"><div><span className="memberAvatar">{member.name.charAt(0).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.upi}</small></div></div><strong>₹{money(total)}</strong></div>
                <div className="qrBillContent">
                  <div className="qr"><QRCodeSVG value={paymentLink} size={180} level="M" /></div>
                  <div className="billDetails">
                    <h3>Billing details</h3>
                    {items.filter(i => i.name.trim()).map(i => <div key={i.id}><span>{i.name}</span><b>₹{money(Number(i.amount) || 0)}</b></div>)}
                    <div className="detailTotal"><span>Total amount</span><b>₹{money(total)}</b></div>
                    <small>Bill for: {member.name}<br />Pay to: {profile.name}<br />UPI ID: {profile.upi}</small>
                    <div className="paymentLinkBox">
                      <span>DIRECT PAYMENT LINK</span>
                      <code>{paymentLink}</code>
                      <div className="paymentActions">
                        <a className="payNow" href={paymentLink}>Pay now ↗</a>
                        <button onClick={copyPaymentLink}>Copy link</button>
                      </div>
                    </div>
                    <button className="primary shareBill" onClick={() => shareBill(member)}>Share this bill ↗</button>
                  </div>
                </div>
              </div>
            ))}</div>
          </div>}
        </section>
      )}

      {shareTarget && (
        <div className="shareOverlay" onClick={() => setShareTarget(null)}>
          <div className="shareModal" onClick={e => e.stopPropagation()}>
            <button className="shareClose" onClick={() => setShareTarget(null)} aria-label="Close">×</button>
            <div className="shareIcon">↗</div>
            <span className="live">SHARE BILL</span>
            <h2>Send {shareTarget.name}'s bill</h2>
            <p>Choose where you want to send the bill. The message includes the billing items, total amount and direct UPI payment link.</p>
            <div className="shareChoices">
              <button className="shareChoice whatsappChoice" onClick={shareOnWhatsApp}>
                <span>◉</span><strong>WhatsApp</strong><small>Open WhatsApp with the bill ready to send</small><b>→</b>
              </button>
              <button className="shareChoice" onClick={shareWithApps}>
                <span>↗</span><strong>Other apps</strong><small>Use your phone's share menu for chats and apps</small><b>→</b>
              </button>
              <button className="shareChoice" onClick={copyBill}>
                <span>⧉</span><strong>Copy bill</strong><small>Copy the complete bill text and payment link</small><b>→</b>
              </button>
            </div>
            <small className="shareHint">WhatsApp opens WhatsApp Web on desktop or the WhatsApp app when supported on your device.</small>
          </div>
        </div>
      )}

      <footer>© 2026 UPI Circle · Split. Scan. Done.</footer>
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}
