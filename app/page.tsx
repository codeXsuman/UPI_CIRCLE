"use client";

import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type User = { id: string; name: string; upi: string; mobile: string; email: string; password?: string };
type Item = { id: number; name: string; amount: string };

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DRAFT_KEY = "upi-bills-draft-v4";

export default function Home() {
  type AppPage = "home" | "account" | "login" | "product" | "profile" | "history";
  const [page, setPage] = useState<AppPage>("home");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const withLoading = async <T,>(task: () => Promise<T>) => {
    setLoading(true);
    try { return await task(); } finally { setLoading(false); }
  };

  const getPageFromUrl = (): AppPage | null => {
    const value = new URLSearchParams(window.location.search).get("view");
    return ["home", "account", "login", "product", "profile", "history"].includes(value || "")
      ? value as AppPage
      : null;
  };

  const navigate = (nextPage: AppPage, replace = false) => {
    const url = nextPage === "home" ? "/" : "/?view=" + nextPage;
    if (replace) window.history.replaceState({ view: nextPage }, "", url);
    else window.history.pushState({ view: nextPage }, "", url);
    setPage(nextPage);
  };
  const [profile, setProfile] = useState<User | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [register, setRegister] = useState({ name: "", upi: "", mobile: "", email: "", password: "" });
  const [login, setLogin] = useState({ email: "", password: "" });
  const [items, setItems] = useState<Item[]>([{ id: 1, name: "", amount: "" }]);
  const [generated, setGenerated] = useState(false);
  const [generatedBillId, setGeneratedBillId] = useState<string | null>(null);
  const [savedInHistory, setSavedInHistory] = useState(false);
  const [historyBills, setHistoryBills] = useState<any[]>([]);
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
    const handlePopState = () => {
      const urlPage = getPageFromUrl();
      if (urlPage) setPage(urlPage);
      else setPage(profile ? "product" : "home");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [profile]);

  useEffect(() => {
    (async () => {
      let saved: any = null;
      try { saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null"); } catch {}
      const urlPage = getPageFromUrl();
      if (urlPage) setPage(urlPage);
      else if (saved?.page) setPage(saved.page);
      if (saved?.register) setRegister(saved.register);
      if (saved?.login) setLogin(saved.login);
      if (Array.isArray(saved?.items) && saved.items.length) setItems(saved.items);
      if (Array.isArray(saved?.selected)) setSelected(saved.selected);
      if (typeof saved?.generated === "boolean") setGenerated(saved.generated);
      if (saved?.generatedBillId) setGeneratedBillId(saved.generatedBillId);
      if (typeof saved?.savedInHistory === "boolean") setSavedInHistory(saved.savedInHistory);

      try {
        setLoading(true);
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json();
        if (data.user) {
          const savedProfile = saved?.profileDraft;
          setProfile(savedProfile ? { ...data.user, ...savedProfile } : { ...data.user, password: "" });
          const targetPage = urlPage || saved?.page || "product";
          setPage(targetPage);
          if (!urlPage) { const url = targetPage === "home" ? "/" : "/?view=" + targetPage; window.history.replaceState({ view: targetPage }, "", url); }
          await loadMembers();
        } else if (saved?.page === "product" || saved?.page === "profile") {
          navigate("home");
        }
      } catch {
        if (saved?.page === "product" || saved?.page === "profile") navigate("home");
      } finally {
        setLoading(false);
        setHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        page, profileDraft: profile, register, login, items, selected, generated,
        generatedBillId, savedInHistory
      }));
    } catch {}
  }, [hydrated, page, profile, register, login, items, selected, generated, generatedBillId, savedInHistory]);

  const registerAccount = async () => {
    if (Object.values(register).some(v => !v.trim())) return pop("Please complete all registration details");
    try {
      setLoading(true);
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(register)
      });
      const data = await res.json();
      if (!res.ok) return pop(data.error || "Unable to create account");
      setProfile({ ...data.user, password: "" });
      setRegister({ name: "", upi: "", mobile: "", email: "", password: "" });
      navigate("product");
      await loadMembers();
      pop("Account created successfully");
    } catch { pop("Unable to create account"); }
    finally { setLoading(false); }
  };

  const loginAccount = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(login)
      });
      const data = await res.json();
      if (!res.ok) return pop(data.error || "Unable to login");
      setProfile({ ...data.user, password: "" });
      setLogin({ email: "", password: "" });
      navigate("product");
      await loadMembers();
      pop("Logged in successfully");
    } catch { pop("Unable to login"); }
    finally { setLoading(false); }
  };

  const logout = async () => {
    setLoading(true);
    try { await fetch("/api/auth/logout", { method: "POST" });
    setProfile(null);
    setMembers([]);
    setSelected([]);
    setGenerated(false);
    navigate("home");
    try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
    pop("Logged out");
    } finally { setLoading(false); }
  };

  const updateProfile = async () => {
    if (!profile) return;
    try {
      setLoading(true);
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
    finally { setLoading(false); }
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
    const note = items.filter(i => i.name.trim()).map(i => i.name.trim()).join(", ").slice(0, 60) || "UPI Bills bill";
    return "upi://pay?pa=" + encodeURIComponent(profile.upi)
      + "&pn=" + encodeURIComponent(profile.name)
      + "&am=" + total.toFixed(2)
      + "&cu=INR"
      + "&tn=" + encodeURIComponent(note);
  }, [profile, items, total]);

  const loadHistory = async () => {
    try {
      const res = await fetch("/api/bills/history", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setHistoryBills(data.bills || []);
    } catch {}
  };

  const openHistory = async () => {
    navigate("history");
    await withLoading(loadHistory);
  };

  const saveInHistory = async () => {
    if (!generatedBillId) return pop("Generate the bill first");
    try {
      setLoading(true);
      const res = await fetch("/api/bills/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billId: generatedBillId })
      });
      const data = await res.json();
      if (!res.ok) return pop(data.error || "Unable to save in history");
      setSavedInHistory(true);
      await loadHistory();
      pop("Bill saved in history");
    } catch {
      pop("Unable to save in history");
    } finally { setLoading(false); }
  };

  const generateBill = async () => {
    if (!profile) return;
    if (!selected.length) return pop("Select at least one registered member");
    if (items.some(item => !item.name.trim() || Number(item.amount) <= 0)) return pop("Complete every bill item first");
    try {
      setLoading(true);
      const res = await fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, recipientIds: selected })
      });
      const data = await res.json();
      if (!res.ok) return pop(data.error || "Unable to save bill");
      setGeneratedBillId(data.billId);
      setSavedInHistory(false);
      setGenerated(true);
      pop("Bill generated successfully");
    } catch { pop("Unable to save bill"); }
    finally { setLoading(false); }
  };

  const shareText = (member: User) => {
    const itemLines = items
      .filter(i => i.name.trim())
      .map(i => "• " + i.name.trim() + " — ₹" + money(Number(i.amount) || 0))
      .join("\n");

    return [
      "UPI Bills Bill",
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
          title: "UPI Bills Bill — ₹" + money(total),
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
    setGeneratedBillId(null);
    setSavedInHistory(false);
    setShareTarget(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    pop("Ready to create a new bill");
  };

  const selectedMembers = members.filter(m => selected.includes(m.id));

  return (
    <main>
      <header>
        <div className="brand" onClick={() => navigate(profile ? "product" : "home")}>
          <b>U</b><strong>UPI<span>Bills</span></strong>
        </div>
        {profile ? (
          <div className="headerActions">
            <button className="historyNav" onClick={openHistory}>History</button>
            <div className="profileMenuWrap">
              <button
                className="profileButton"
                aria-label="Open profile menu"
                aria-expanded={profileMenuOpen}
                onClick={() => {
                  if (window.innerWidth <= 600) setProfileMenuOpen(v => !v);
                  else navigate("profile");
                }}
              >
                <span>{profile.name.charAt(0).toUpperCase()}</span><strong>{profile.name.split(" ")[0]}</strong>
              </button>
              {profileMenuOpen && (
                <div className="mobileProfileMenu">
                  <button onClick={() => { setProfileMenuOpen(false); openHistory(); }}>History</button>
                  <button onClick={() => { setProfileMenuOpen(false); navigate("profile"); }}>Profile</button>
                </div>
              )}
            </div>
          </div>
        ) : <div className="accountMenuWrap">
          <button className="profilePlaceholder accountButton" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(v => !v)}>Account <span className="accountChevron">↓</span></button>
          {accountMenuOpen && <div className="accountDropdown">
            <button onClick={() => { setAccountMenuOpen(false); navigate("account"); }}>Create account</button>
            <button onClick={() => { setAccountMenuOpen(false); navigate("login"); }}>Login</button>
          </div>}
        </div>}
      </header>

      {page === "home" && (
        <section className="authLanding">
          <div className="authHero">
            <div className="eyebrow"><span>●</span> UPI BILLS <b>SIMPLE BILLING</b></div>
            <h1>Split bills.<br /><i>Together.</i></h1>
            <p>A simple way to create, share and manage bills with your friends.</p>
            <div className="authActions">
              <button className="primary authPrimary" onClick={() => navigate("account")}>Create a new account <span>→</span></button>
              <button className="secondary authSecondary" onClick={() => navigate("login")}>Login <span>↗</span></button>
            </div>
            <small className="authNote">Create your account once. Create bills, scan to pay, and keep your payment history in one place.</small>
          </div>
          <div className="authVisual">
            <div className="authOrb orbOne" /><div className="authOrb orbTwo" />
            <div className="authPanel">
              <div className="authPanelTop"><span>UPI BILLS</span><b>●</b></div>
              <div className="authPanelLine" />
              <div className="authPanelBalance"><small>TOTAL BILLS</small><strong>₹ 2,450.00</strong></div>
              <div className="authRows">
                <div><b>SC</b><span><strong>Coffee bill</strong><small>4 members</small></span><em>₹ 320</em></div>
                <div><b>TR</b><span><strong>Trip bill</strong><small>6 members</small></span><em>₹ 1,840</em></div>
                <div><b>FD</b><span><strong>Dinner bill</strong><small>3 members</small></span><em>₹ 290</em></div>
              </div>
            </div>
          </div>
        </section>
      )}

      {page === "account" && (
        <section className="account">
          <div className="card accountCard">
            <div className="accountBadge">CREATE ACCOUNT</div>
            <label>UPI BILLS REGISTRATION</label>
            <h1>Create your account</h1>
            <p>Your registration draft is kept in this browser if you accidentally refresh.</p>
            <div className="formStack">
              <label>Name<input value={register.name} placeholder="Your full name" onChange={e => setRegister({ ...register, name: e.target.value })} /></label>
              <label>UPI ID<input value={register.upi} placeholder="yourname@upi" onChange={e => setRegister({ ...register, upi: e.target.value })} /></label>
              <label>Mobile number<input value={register.mobile} inputMode="numeric" maxLength={10} placeholder="10-digit mobile number" onChange={e => setRegister({ ...register, mobile: e.target.value.replace(/\D/g, "") })} /></label>
              <label>Email<input value={register.email} type="email" placeholder="you@example.com" onChange={e => setRegister({ ...register, email: e.target.value })} /></label>
              <label>Password<input value={register.password} type="password" placeholder="Create a password" onChange={e => setRegister({ ...register, password: e.target.value })} /></label>
            </div>
            <button className="primary accountSubmit" onClick={registerAccount}>Create account</button>
            <button className="wideBtn" onClick={() => navigate("home")}>Back to home</button>
          </div>
        </section>
      )}

      {page === "login" && (
        <section className="account">
          <div className="card accountCard">
            <div className="accountBadge">WELCOME BACK</div>
            <label>UPI BILLS LOGIN</label><h1>Login</h1>
            <p>Your login form also stays on this page after an accidental refresh.</p>
            <label>Email address<input value={login.email} type="email" placeholder="you@example.com" onChange={e => setLogin({ ...login, email: e.target.value })} /></label>
            <label>Password<input value={login.password} type="password" placeholder="Your password" onChange={e => setLogin({ ...login, password: e.target.value })} /></label>
            <button className="primary accountSubmit" onClick={loginAccount}>Login</button>
            <button className="wideBtn" onClick={() => navigate("home")}>Back to home</button>
          </div>
        </section>
      )}

      {page === "profile" && profile && (
        <section className="account profilePage">
          <div className="card accountCard">
            <div className="accountBadge">YOUR PROFILE</div>
            <label>UPI BILLS ACCOUNT</label><h1>Edit profile</h1>
            <p>Changes you type here remain in the current browser session until you save them.</p>
            <div className="formStack">
              <label>Name<input value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} /></label>
              <label>UPI ID<input value={profile.upi} onChange={e => setProfile({ ...profile, upi: e.target.value })} /></label>
              <label>Mobile number<input value={profile.mobile} maxLength={10} onChange={e => setProfile({ ...profile, mobile: e.target.value.replace(/\D/g, "") })} /></label>
              <label>Email<input value={profile.email} type="email" onChange={e => setProfile({ ...profile, email: e.target.value })} /></label>
              <label>Password<input value={profile.password || ""} type="password" placeholder="Leave blank to keep current" onChange={e => setProfile({ ...profile, password: e.target.value })} /></label>
            </div>
            <button className="primary accountSubmit" onClick={updateProfile}>Save changes</button>
            <button className="wideBtn" onClick={() => navigate("product")}>Back to product</button>
            <button className="wideBtn" onClick={logout}>Logout</button>
          </div>
        </section>
      )}

      {page === "product" && profile && (
        <section className="productPage">
          <div className="productHeader">
            <div><div className="eyebrow"><span>●</span> UPI BILLS <b>YOUR SPACE</b></div><h1>Create a bill</h1><p>Create a bill for people who are registered on UPI Bills.</p></div>

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
            <div className="generatedHead"><div><span className="live">● GENERATED</span><h2>UPI bills ready to share</h2><p>Each selected member has a personal QR bill with item details and a direct UPI payment link.</p></div><div className="generatedActions"><button onClick={() => setGenerated(false)}>Edit</button><button className={"historySaveBtn " + (savedInHistory ? "saved" : "")} onClick={saveInHistory} disabled={savedInHistory}>{savedInHistory ? "✓ Saved" : "＋ Save"}</button><button className="primary newBillBtn" onClick={createNewBill}>＋ New bill</button></div></div>
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
                    <div className="paymentActions">
                      <a className="payNow" href={paymentLink}>Pay now ↗</a>
                      <button onClick={copyPaymentLink}>Copy link</button>
                    </div>
                    <button className="primary shareBill" onClick={() => shareBill(member)}>Share this bill ↗</button>
                  </div>
                </div>
              </div>
            ))}</div>
          </div>}
        </section>
      )}

      {page === "history" && profile && (
        <section className="historyPage">
          <div className="historyHeader">
            <div>
              <div className="eyebrow"><span>●</span> UPI BILLS <b>YOUR HISTORY</b></div>
              <h1>Bill history</h1>
              <p>Saved bills are stored with your account so you can revisit their items, amount and payment details.</p>
            </div>
            <div className="historyHeaderActions">
              <button className="secondary" onClick={() => navigate("product")}>Create a bill</button>
            </div>
          </div>
          {!historyBills.length ? (
            <div className="card historyEmpty">
              <div className="historyEmptyIcon">↗</div>
              <h2>No saved bills yet</h2>
              <p>Generate a bill and choose “Save in history” to keep it here.</p>
              <button className="primary" onClick={() => navigate("product")}>Create your first bill →</button>
            </div>
          ) : (
            <div className="historyList">
              {historyBills.map((bill) => (
                <div className="card historyCard" key={bill.id}>
                  <div className="historyCardTop">
                    <div>
                      <span className="live">● SAVED BILL</span>
                      <h2>Bill to {bill.recipients.map((r:any) => r.name).join(", ")}</h2>
                      <small>{new Date(bill.savedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small>
                    </div>
                    <strong>₹{money(Number(bill.totalAmount))}</strong>
                  </div>
                  <div className="historyItems">
                    {bill.items.map((item:any) => (
                      <div key={item.id}><span>{item.name}</span><b>₹{money(Number(item.amount))}</b></div>
                    ))}
                  </div>
                  <div className="historyMeta">
                    <span>Pay to <b>{bill.creatorName}</b></span>
                    <span>UPI ID <b>{bill.creatorUpi}</b></span>
                  </div>
                  <div className="historyCardActions">
                    <button className="secondary" onClick={() => navigate("product")}>Create new bill</button>
                    <button className="primary" onClick={() => pop("Historical bill details are shown above")}>View bill details</button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                <span className="whatsappLogo" aria-hidden="true">
                  <svg viewBox="0 0 32 32" role="img"><path d="M16 3.2c-7.06 0-12.8 5.55-12.8 12.4 0 2.2.59 4.26 1.62 6.04L3.05 28.8l7.39-1.69A13 13 0 0 0 16 28c7.06 0 12.8-5.55 12.8-12.4S23.06 3.2 16 3.2Zm0 22.55c-1.98 0-3.83-.53-5.42-1.45l-.39-.23-4.38 1 1.01-4.17-.25-.4a10.36 10.36 0 0 1-1.59-5.5C4.98 10.48 9.92 5.7 16 5.7s11.02 4.78 11.02 10.3S22.08 25.75 16 25.75Zm5.96-7.68c-.33-.16-1.95-.94-2.25-1.05-.3-.11-.52-.16-.74.16-.22.33-.85 1.05-1.04 1.27-.19.22-.38.25-.71.08-.33-.16-1.39-.5-2.65-1.59-.98-.85-1.64-1.89-1.83-2.21-.19-.33-.02-.5.14-.66.15-.15.33-.38.49-.57.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.57-.08-.16-.74-1.78-1.01-2.44-.27-.65-.54-.56-.74-.57h-.63c-.22 0-.57.08-.87.41-.3.33-1.14 1.11-1.14 2.71s1.17 3.14 1.33 3.36c.16.22 2.3 3.53 5.58 4.95.78.34 1.39.54 1.86.69.78.25 1.49.21 2.05.13.63-.09 1.95-.8 2.22-1.57.27-.77.27-1.43.19-1.57-.08-.14-.3-.22-.63-.38Z"/></svg>
                </span><strong>WhatsApp</strong><small>Open WhatsApp with the bill ready to send</small><b>→</b>
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

      {loading && (
        <div className="loadingOverlay" role="status" aria-live="polite" aria-label="Loading">
          <div className="loadingCard">
            <span className="loadingSpinner" aria-hidden="true" />
            <span>Loading...</span>
          </div>
        </div>
      )}

      <footer>© 2026 UPI Bills · Split. Scan. Done.</footer>
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}
