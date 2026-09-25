"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";

type User = { id: string; name: string; upi: string; mobile: string; email: string; password?: string };
type Item = { id: number; name: string; amount: string };

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DRAFT_KEY = "upi-bills-draft-v5";
const GENERAL_DRAFT_TTL_MS = 30 * 1000;
const BILL_DRAFT_TTL_MS = 10 * 60 * 1000;

function ToastNotification({ message, type }: { message: string; type: "success" | "error" | "info" }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="toastPortal" aria-live="polite">
      <div className={"toast toast-" + type} role="status">
        <span className="toastIcon" aria-hidden="true">{type === "success" ? "✓" : type === "error" ? "!" : "i"}</span>
        <div className="toastCopy">
          <strong>{message}</strong>
          {type === "success" && <small>{message.includes("Bill") ? "Your bill is ready to share" : "Done successfully"}</small>}
        </div>
        <span className="toastClose" aria-hidden="true">×</span>
        <span className="toastProgress" aria-hidden="true" />
      </div>
    </div>,
    document.body
  );
}

export default function Home() {
  type AppPage = "home" | "account" | "login" | "dashboard" | "product" | "mine" | "others" | "profile";
  const [page, setPage] = useState<AppPage>("home");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState({ mine: false, others: false, dashboard: false });
  const [dataLoaded, setDataLoaded] = useState({ mine: false, others: false, dashboard: false });
  const [dataError, setDataError] = useState({ mine: "", others: "" });
  const withLoading = async <T,>(task: () => Promise<T>) => {
    setLoading(true);
    try { return await task(); } finally { setLoading(false); }
  };

  const getPageFromUrl = (): AppPage | null => {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const routes: Record<string, AppPage> = {
      "/": "home",
      "/dashboard": "dashboard",
      "/login": "login",
      "/register": "account",
      "/account": "account",
      "/profile": "profile",
      "/bills/create": "product",
      "/bills/mine": "mine",
      "/bills/others": "others",
    };
    return routes[path] || null;
  };

  const pagePath = (nextPage: AppPage) => ({
    home: "/",
    account: "/register",
    login: "/login",
    dashboard: "/dashboard",
    product: "/bills/create",
    mine: "/bills/mine",
    others: "/bills/others",
    profile: "/profile",
  }[nextPage]);

  const navigate = (nextPage: AppPage, replace = false) => {
    const url = pagePath(nextPage);
    const currentPage = getPageFromUrl();
    
    // Never create a duplicate browser-history entry for the page that is
    // already open. This keeps Back/Forward predictable.
    if (currentPage === nextPage) {
      if (replace) window.history.replaceState({ page: nextPage }, "", url);
      touchDraftActivity(nextPage);
      setPage(nextPage);
      return;
    }

    if (replace) window.history.replaceState({ page: nextPage }, "", url);
    else window.history.pushState({ page: nextPage }, "", url);
    touchDraftActivity(nextPage);
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const [profile, setProfile] = useState<User | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [recipientAmounts, setRecipientAmounts] = useState<Record<string, string>>({});
  const [openBillId, setOpenBillId] = useState<string | null>(null);
  const selectedShareTotal = selected.reduce((sum, id) => sum + (Number(recipientAmounts[id]) || 0), 0);
  const [register, setRegister] = useState({ name: "", upi: "", mobile: "", email: "", password: "" });
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [registerErrors, setRegisterErrors] = useState<Record<string, string>>({});
  const [registerServerError, setRegisterServerError] = useState("");
  const [passwordStrength, setPasswordStrength] = useState<"weak" | "medium" | "strong" | "">("");
  const [existingAccount, setExistingAccount] = useState(false);
  const [existingAccountMessage, setExistingAccountMessage] = useState("An account already exists with one or more of these details.");
  const [login, setLogin] = useState({ email: "", password: "" });
  const [loginErrors, setLoginErrors] = useState<Record<string, string>>({});
  const [loginCredentialError, setLoginCredentialError] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [items, setItems] = useState<Item[]>([{ id: 1, name: "", amount: "" }]);

  const [myBills, setMyBills] = useState<any[]>([]);
  const [otherBills, setOtherBills] = useState<any[]>([]);
  const [dashboardStats, setDashboardStats] = useState({ created: 0, pending: 0, received: 0, owing: 0 });
  const [myBillFilter, setMyBillFilter] = useState<"all"|"pending"|"received">("all");
  const [otherBillFilter, setOtherBillFilter] = useState<"all"|"pending"|"received">("all");
  const [billSearch, setBillSearch] = useState("");
  const [toast, setToast] = useState("");
  const [toastType, setToastType] = useState<"success" | "error" | "info">("success");
  const [toastTarget, setToastTarget] = useState<string | null>(null);
  const [billValidationError, setBillValidationError] = useState("");
  const [billCreatedSuccess, setBillCreatedSuccess] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [splitMode, setSplitMode] = useState<"equal" | "custom">("equal");
  const toastTimerRef = useRef<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const draftActivityRef = useRef<number>(Date.now());
  const draftResettingRef = useRef(false);
  const getDraftTtl = (draftPage: AppPage) => draftPage === "product" ? BILL_DRAFT_TTL_MS : GENERAL_DRAFT_TTL_MS;
  const touchDraftActivity = (_draftPage = page) => {
    draftActivityRef.current = Date.now();
  };

  const pop = (message: string, type?: "success" | "error" | "info", target?: string) => {
    const inferredType = type || (/unable|couldn't|could not|failed|error|invalid|network|connection|mismatch|fix the highlighted|must add|select at least|provide/i.test(message) ? "error" : "success");
    setToastType(inferredType);
    setToastTarget(target || null);
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast("");
      setToastTarget(null);
    }, 3200);
  };

  const loadMembers = async () => {
    try {
      const res = await fetch("/api/members", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setMembers(data.members || []);
    } catch {}
  };

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeMenu = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const menu = document.querySelector(".accountMenuWrap");
      if (menu && !menu.contains(target)) setAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("touchstart", closeMenu);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("touchstart", closeMenu);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    const handlePopState = () => {
      const urlPage = getPageFromUrl();

      if (urlPage) {
        // Older sessions can contain duplicate entries for the same route.
        // When Back lands on an identical route, skip that duplicate so the
        // user reaches the previous actual page with a single Back action.
        if (urlPage === page) {
          window.history.go(-1);
          return;
        }
        touchDraftActivity(urlPage);
        setPage(urlPage);
      } else {
        const next = profile ? "dashboard" : "home";
        if (next === page) {
          window.history.go(-1);
          return;
        }
        touchDraftActivity(next);
        setPage(next);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [profile, page]);

  useEffect(() => {
    (async () => {
      let saved: any = null;
      try { saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null"); } catch {}

      const draftPage = saved?.page || getPageFromUrl() || "home";
      const draftIsFresh = saved?.savedAt && (Date.now() - Number(saved.savedAt) < getDraftTtl(draftPage));
      if (!draftIsFresh) {
        try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
        saved = null;
      } else {
        // A refresh/re-open restarts the inactivity countdown.
        touchDraftActivity(draftPage);
      }

      const urlPage = getPageFromUrl();
      if (urlPage) setPage(urlPage);
      else if (saved?.page) setPage(saved.page);

      if (saved?.register) setRegister(saved.register);
      if (saved?.privacyAccepted) setPrivacyAccepted(true);
      if (saved?.login) setLogin(saved.login);
      if (Array.isArray(saved?.items) && saved.items.length) setItems(saved.items);
      if (Array.isArray(saved?.selected)) setSelected(saved.selected);
      if (saved?.recipientAmounts && typeof saved.recipientAmounts === "object") setRecipientAmounts(saved.recipientAmounts);

      try {
        setLoading(true);
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json();
        if (data.user) {
          const savedProfile = saved?.profileDraft;
          setProfile(savedProfile ? { ...data.user, ...savedProfile } : { ...data.user, password: "" });

          // Keep a real deep-link page on refresh. Only the authenticated root
          // and public auth pages resolve to Dashboard.
          const resolvedPage = getPageFromUrl();
          if (!resolvedPage || resolvedPage === "home" || resolvedPage === "login" || resolvedPage === "account") {
            setPage("dashboard");
            window.history.replaceState({ page: "dashboard" }, "", "/dashboard");
            touchDraftActivity("dashboard");
          } else {
            setPage(resolvedPage);
            touchDraftActivity(resolvedPage);
          }
          await loadMembers();
        } else if (urlPage === "account" || urlPage === "login") {
          setPage(urlPage);
        } else {
          navigate("home", true);
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
    if (!hydrated || draftResettingRef.current) return;
    const timer = window.setTimeout(() => {
      const savedAt = Date.now();
      draftActivityRef.current = savedAt;
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
          savedAt,
          page,
          profileDraft: profile,
          register,
          privacyAccepted,
          login,
          items,
          selected,
          recipientAmounts,
        }));
      } catch {}
    }, 750);
    return () => window.clearTimeout(timer);
  }, [hydrated, page, profile, register, privacyAccepted, login, items, selected, recipientAmounts]);

  // Reset the inactivity timer whenever the user is actively operating the app.
  // A refresh/back also restarts the timer. Staying idle allows the draft to expire.
  useEffect(() => {
    if (!hydrated) return;
    const events = ["pointerdown", "keydown", "input", "change", "touchstart"];
    const onActivity = () => touchDraftActivity();
    events.forEach(event => window.addEventListener(event, onActivity, { passive: true }));
    return () => events.forEach(event => window.removeEventListener(event, onActivity));
  }, [hydrated, page]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setInterval(() => {
      const ttl = getDraftTtl(page);
      if (Date.now() - draftActivityRef.current <= ttl) return;

      draftResettingRef.current = true;
      try { sessionStorage.removeItem(DRAFT_KEY); } catch {}

      setRegister({ name: "", upi: "", mobile: "", email: "", password: "" });
      setPrivacyAccepted(false);
      setLogin({ email: "", password: "" });
      setItems([{ id: 1, name: "", amount: "" }]);
      setSelected([]);
      setRecipientAmounts({});
      setRegisterErrors({});
      setExistingAccount(false);
      setToast("");
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      draftActivityRef.current = Date.now();
      draftResettingRef.current = false;
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hydrated, page]);


  const registerAccount = async () => {
    const errors: Record<string, string> = {};
    const email = register.email.trim();
    const mobile = register.mobile.trim();

    setRegisterServerError("");

    if (!register.name.trim()) errors.name = "Name is required";
    if (!register.upi.trim()) errors.upi = "UPI ID is required";
    if (!email) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "Enter a valid email address";
    if (mobile && !/^[6-9]\d{9}$/.test(mobile)) errors.mobile = "Enter a valid 10-digit Indian mobile number";
    if (!register.password) errors.password = "Password is required";
    else if (register.password.length < 6) errors.password = "Password must be at least 6 characters";
    if (!privacyAccepted) errors.privacy = "Please accept the Privacy Policy to continue";

    setRegisterErrors(errors);
    if (Object.keys(errors).length) {
      const first = Object.keys(errors)[0];
      document.getElementById("register-" + first)?.focus();
      return pop("Please fix the highlighted fields", "error");
    }

    try {
      setLoading(true);
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(register)
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [data.conflict].filter(Boolean);
        const nextErrors: Record<string, string> = {};
        if (conflicts.includes("email")) nextErrors.email = "An account with this email already exists.";
        if (conflicts.includes("UPI ID")) nextErrors.upi = "An account with this UPI ID already exists.";
        if (conflicts.includes("mobile number")) nextErrors.mobile = "An account with this mobile number already exists.";
        if (conflicts.includes("multiple")) {
          if (data.error) setRegisterServerError(data.error);
        } else if (!Object.keys(nextErrors).length && data.error) {
          setRegisterServerError(data.error);
        }
        setRegisterErrors(nextErrors);
        setExistingAccount(false);
        const first = Object.keys(nextErrors)[0];
        if (first) document.getElementById("register-" + first)?.focus();
        return;
      }

      if (!res.ok) {
        setRegisterErrors({});
        setRegisterServerError(data.error || "We couldn't create your account right now. Please try again in a moment.");
        return;
      }

      setProfile({ ...data.user, password: "" });
      setRegister({ name: "", upi: "", mobile: "", email: "", password: "" });
      setPrivacyAccepted(false);
      setRegisterErrors({});
      setRegisterServerError("");
      navigate("dashboard", true);
      await loadMembers();
      pop("Account created successfully", "success");
    } catch {
      setRegisterErrors({});
      setRegisterServerError("Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const loginAccount = async () => {
    const errors: Record<string, string> = {};
    if (!login.email.trim()) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login.email.trim())) errors.email = "Enter a valid email address";
    if (!login.password) errors.password = "Password is required";
    if (Object.keys(errors).length) {
      setLoginErrors(errors);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(login)
      });
      const data = await res.json();
      if (!res.ok) {
        // Show one generic credential error only; do not reveal which credential failed.
        setLoginErrors({});
        setLoginCredentialError("Invalid email address or password");
        pop("Invalid email address or password", "error");
        return;
      }
      setProfile({ ...data.user, password: "" });
      setLogin({ email: "", password: "" });
      setLoginErrors({});
      setLoginCredentialError("");
      setShowLoginPassword(false);
      navigate("dashboard", true);
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
    setRecipientAmounts({});
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

  const toggleMember = (id: string) => {
    setBillValidationError("");
    setBillCreatedSuccess(false);
    setSelected(old => {
      if (old.includes(id)) {
        setRecipientAmounts(amounts => {
          const next = { ...amounts };
          delete next[id];
          return next;
        });
        return old.filter(x => x !== id);
      }
      return [...old, id];
    });
  };

  const sanitizeMoneyInput = (value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, "");
    const dot = cleaned.indexOf(".");
    if (dot === -1) return cleaned;
    return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  };

  const updateItem = (id: number, key: "name" | "amount", value: string) => {
    setBillValidationError("");
    setBillCreatedSuccess(false);
    setItems(old => old.map(item => item.id === id
      ? { ...item, [key]: key === "amount" ? sanitizeMoneyInput(value) : value }
      : item));
  };

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [items]
  );

  const makePaymentLink = (upi: string, name: string, amount: number) => "upi://pay?pa=" + encodeURIComponent(upi) + "&pn=" + encodeURIComponent(name) + "&am=" + amount.toFixed(2) + "&cu=INR";



  const deleteMyBill = async (billId: string) => {
    if (!window.confirm("Delete this bill? This cannot be undone.")) return;
    try {
      setLoading(true);
      const res = await fetch("/api/bills/mine", { method:"DELETE", headers:{"Content-Type":"application/json"}, body:JSON.stringify({billId}) });
      const data = await res.json();
      if (!res.ok) return pop(data.error || "Unable to delete bill");
      setMyBills(old => old.filter(b => b.id !== billId));
      setOpenBillId(null);
      pop("Bill deleted");
    } catch { pop("Unable to delete bill"); } finally { setLoading(false); }
  };

  const updateMyBillStatus = async (billId: string, paymentStatus: "pending" | "received") => {
    try {
      setLoading(true);
      const res = await fetch("/api/bills/mine", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({billId,paymentStatus}) });
      const data = await res.json();
      if (!res.ok) return pop(data.error || "Unable to update payment status");
      await loadMyBills();
      pop(paymentStatus === "received" ? "Payment marked as received" : "Payment marked as pending");
    } catch { pop("Unable to update payment status"); } finally { setLoading(false); }
  };

  const loadMyBills = async (showError = false) => {
    setDataLoading(prev => ({ ...prev, mine: true }));
    try {
      const res = await fetch("/api/bills/mine", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setMyBills(data.bills || []);
        setDataError(prev => ({ ...prev, mine: "" }));
        return true;
      }
      if (showError) pop(data.error || "Couldn't refresh your bills", "error");
      return false;
    } catch {
      if (showError) pop("Network connection lost · Couldn't refresh your bills", "error");
      return false;
    }
    finally {
      setDataLoading(prev => ({ ...prev, mine: false }));
      setDataLoaded(prev => ({ ...prev, mine: true }));
    }
  };

  const loadOtherBills = async (showError = false) => {
    setDataLoading(prev => ({ ...prev, others: true }));
    try {
      const res = await fetch("/api/bills/others", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setOtherBills(data.bills || []);
        setDataError(prev => ({ ...prev, others: "" }));
        return true;
      }
      if (showError) pop(data.error || "Couldn't refresh shared bills", "error");
      return false;
    } catch {
      if (showError) pop("Network connection lost · Couldn't refresh shared bills", "error");
      return false;
    }
    finally {
      setDataLoading(prev => ({ ...prev, others: false }));
      setDataLoaded(prev => ({ ...prev, others: true }));
    }
  };

  const refreshDashboardStats = async () => {
    setDataLoading(prev => ({ ...prev, dashboard: true }));
    try {
      const [mineRes, otherRes] = await Promise.all([
        fetch("/api/bills/mine", { cache: "no-store" }),
        fetch("/api/bills/others", { cache: "no-store" })
      ]);
      const mine = await mineRes.json();
      const other = await otherRes.json();
      const mineBills = mine.bills || [];
      const otherBillsData = other.bills || [];
      setMyBills(mineBills);
      setOtherBills(otherBillsData);
      setDashboardStats({
        created: mineBills.length,
        pending: mineBills.filter((b:any)=>b.paymentStatus==="pending").length,
        received: mineBills.filter((b:any)=>b.paymentStatus==="received").reduce((s:number,b:any)=>s+Number(b.totalAmount||0),0),
        owing: otherBillsData.filter((b:any)=>b.paymentStatus!=="received").reduce((s:number,b:any)=>s+(Number(b.recipientAmount)||Number(b.totalAmount)||0),0)
      });
    } catch {}
    finally {
      setDataLoading(prev => ({ ...prev, dashboard: false }));
      setDataLoaded(prev => ({ ...prev, dashboard: true }));
    }
  };

  // Navigation and refresh are intentionally separate: refreshing data must not
  // create another browser-history entry for the same URL.
  const openMyBills = () => navigate("mine");
  const openOtherBills = () => navigate("others");
  const refreshMyBills = async () => {
    const ok = await loadMyBills(true);
    if (ok !== false) pop("Bills refreshed · You're up to date", "success");
  };
  const refreshOtherBills = async () => {
    const ok = await loadOtherBills(true);
    if (ok !== false) pop("Bills refreshed · You're up to date", "success");
  };

  useEffect(() => {
    if (!hydrated || !profile) return;
    if (page === "dashboard") refreshDashboardStats();
    else if (page === "mine") loadMyBills();
    else if (page === "others") loadOtherBills();
  }, [hydrated, profile?.id, page]);

  const getEqualShareAmounts = () => {
    const next: Record<string, string> = {};
    if (!selected.length || total <= 0) return next;
    const totalCents = Math.round(total * 100);
    const baseCents = Math.floor(totalCents / selected.length);
    const remainderCents = totalCents - baseCents * selected.length;
    selected.forEach((id, index) => {
      next[id] = ((baseCents + (index === 0 ? remainderCents : 0)) / 100).toFixed(2);
    });
    return next;
  };

  const hasCustomSplit = splitMode === "custom";
  const displayShareAmounts = hasCustomSplit ? recipientAmounts : getEqualShareAmounts();
  const displayShareTotal = hasCustomSplit
    ? selectedShareTotal
    : Object.values(displayShareAmounts).reduce((sum, value) => sum + (Number(value) || 0), 0);

  const splitEvenly = () => {
    if (!selected.length || total <= 0) return;
    setBillValidationError("");
    setBillCreatedSuccess(false);
    setSplitMode("equal");
    setRecipientAmounts(getEqualShareAmounts());
  };

  const setRecipientAmount = (id: string, value: string) => {
    setBillValidationError("");
    setBillCreatedSuccess(false);
    setSplitMode("custom");
    setRecipientAmounts(prev => ({ ...prev, [id]: sanitizeMoneyInput(value) }));
  };

  const generateBill = async () => {
    if (!profile) return;

    setBillValidationError("");

    if (!selected.length) {
      document.querySelector(".registeredList, .emptyMembers")?.scrollIntoView({ behavior: "smooth", block: "center" });
      setBillValidationError("Select at least one registered member.");
      return;
    }

    const invalidItem = items.find(item => !item.name.trim() || !item.amount.trim() || Number(item.amount) <= 0);
    if (invalidItem) {
      const itemRow = document.querySelector(`.billItem[data-item-id="${invalidItem.id}"]`) as HTMLElement | null;
      const input = itemRow?.querySelector(!invalidItem.name.trim() ? 'input[data-field="name"]' : 'input[data-field="amount"]') as HTMLInputElement | null;
      const message = !invalidItem.name.trim()
        ? "Enter a name for each bill item."
        : !invalidItem.amount.trim()
          ? "Enter an amount for each bill item."
          : "Enter an amount greater than 0 for each bill item.";
      setBillValidationError(message);
      if (input) {
        input.setCustomValidity(message);
        input.reportValidity();
        input.focus();
      }
      return;
    }

    if (total <= 0) {
      setBillValidationError("Add at least one bill item with a valid amount.");
      document.querySelector(".billItems")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (hasCustomSplit) {
      const missingShare = selected.find(id => !(recipientAmounts[id] || "").trim() || Number(recipientAmounts[id]) <= 0);
      if (missingShare) {
        setBillValidationError("Enter a valid amount for every selected member, or use Split equally.");
        document.querySelector(".splitBox")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      if (Math.abs(selectedShareTotal - total) > 0.001) {
        setBillValidationError("Member shares must add up to the total bill.");
        document.querySelector(".splitBox")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }

    try {
      setLoading(true);
      const res = await fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, recipientIds: selected, recipientAmounts: hasCustomSplit ? recipientAmounts : {} })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = data.error || (res.status >= 500
          ? "Couldn't create the bill. Something went wrong while saving it."
          : "Couldn't create the bill. Please check the details and try again.");
        pop(message, "error");
        return;
      }

      setItems([{ id: Date.now(), name: "", amount: "" }]);
      setSelected([]);
      setRecipientAmounts({});
      setBillValidationError("");
      setBillCreatedSuccess(true);
      pop("Bill created successfully", "success");
    } catch {
      pop("Check your connection and try again.", "error");
    } finally {
      setLoading(false);
    }
  };
  const selectedMembers = members.filter(m => selected.includes(m.id));

  return (
    <main key={page} className="pageMotion">
      <header>
        <div className="brand" role="button" tabIndex={0} aria-label="Go to home" onClick={() => navigate(profile ? "dashboard" : "home")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate(profile ? "dashboard" : "home"); }}>
          <b>U</b><strong>UPI<span>Bills</span></strong>
        </div>
        {profile ? (
          <div className="headerActions">
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
                  <button onClick={() => { setProfileMenuOpen(false); navigate("profile"); }}>Profile</button>
                </div>
              )}
            </div>
          </div>
        ) : <div className="accountMenuWrap">
          <button className="profilePlaceholder accountButton" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(v => !v)}>Account</button>
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
            <h1>Share bills.<br /><i>Together.</i></h1>
            <p>A simple way to create, share and manage bills with your friends.</p>
            <div className="authActions">
              <button className="primary authPrimary" onClick={() => navigate("account")}>Create a new account <span>→</span></button>
              <button className="secondary authSecondary loginHighlight" onClick={() => navigate("login")}><span className="loginDot">●</span> Login</button>
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
        <section key="account-page" className="account authPageTransition">
          <div className="card accountCard">
            <div className="accountBadge">CREATE ACCOUNT</div>
            <label>UPI BILLS REGISTRATION</label>
            <h1>Create your account</h1>
            <p>Your registration draft is kept in this browser if you accidentally refresh.</p>
            <div className="formStack">
              <label className={registerErrors.name ? "fieldError" : ""}>Name
                <input id="register-name" value={register.name} aria-invalid={!!registerErrors.name} placeholder="Your full name" onChange={e => { setRegister({ ...register, name: e.target.value }); setRegisterErrors(old => ({ ...old, name: "" })); setRegisterServerError(""); }} />
                {registerErrors.name && <span className="fieldErrorMessage">{registerErrors.name}</span>}
              </label>
              <label className={registerErrors.upi ? "fieldError" : ""}>UPI ID
                <input id="register-upi" value={register.upi} aria-invalid={!!registerErrors.upi} placeholder="yourname@upi" onChange={e => { setRegister({ ...register, upi: e.target.value }); setRegisterErrors(old => ({ ...old, upi: "" })); setRegisterServerError(""); }} />
                {registerErrors.upi && <span className="fieldErrorMessage">{registerErrors.upi}</span>}
              </label>
              <label className={registerErrors.mobile ? "fieldError" : ""}>Mobile number <span className="optionalTag">Optional</span>
                <input id="register-mobile" value={register.mobile} aria-invalid={!!registerErrors.mobile} inputMode="numeric" maxLength={10} placeholder="10-digit mobile number" onChange={e => { setRegister({ ...register, mobile: e.target.value.replace(/\D/g, "") }); setRegisterErrors(old => ({ ...old, mobile: "" })); setRegisterServerError(""); }} />
                {registerErrors.mobile && <span className="fieldErrorMessage">{registerErrors.mobile}</span>}
              </label>
              <label className={registerErrors.email ? "fieldError" : ""}>Email
                <input id="register-email" value={register.email} aria-invalid={!!registerErrors.email} type="email" placeholder="you@example.com" onChange={e => { setRegister({ ...register, email: e.target.value }); setRegisterErrors(old => ({ ...old, email: "" })); setRegisterServerError(""); }} />
                {registerErrors.email && <span className="fieldErrorMessage">{registerErrors.email}</span>}
              </label>
              <label className={registerErrors.password ? "fieldError" : ""}>Password
                <input id="register-password" value={register.password} aria-invalid={!!registerErrors.password} type="password" placeholder="Create a password" onChange={e => {
                  const value = e.target.value;
                  setRegister({ ...register, password: value });
                  setRegisterErrors(old => ({ ...old, password: "" }));
                  setRegisterServerError("");
                  if (!value) setPasswordStrength("");
                  else if (value.length < 8 || !/[A-Za-z]/.test(value) || !/\d/.test(value)) setPasswordStrength("weak");
                  else if (value.length < 10 || !/[A-Z]/.test(value) || !/[^A-Za-z0-9]/.test(value)) setPasswordStrength("medium");
                  else setPasswordStrength("strong");
                }} />
                {register.password && <small className={"passwordStrength " + passwordStrength}>Password strength: <strong>{passwordStrength}</strong></small>}
                {registerErrors.password && <span className="fieldErrorMessage">{registerErrors.password}</span>}
              </label>
            </div>
            <div className={"privacyCheckWrap " + (registerErrors.privacy ? "fieldError" : "")}>
              <label className="privacyCheck">
                <input id="register-privacy" type="checkbox" checked={privacyAccepted} onChange={e => { setPrivacyAccepted(e.target.checked); setRegisterErrors(old => ({ ...old, privacy: "" })); }} />
                <span>I agree to the <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
              </label>
              {registerErrors.privacy && <small className="privacyError">{registerErrors.privacy}</small>}
            </div>
            {registerServerError && <div className="registerServerError" role="alert"><span>!</span><div><strong>Registration couldn’t be completed</strong><small>{registerServerError}</small></div></div>}
            <button className="primary accountSubmit" onClick={registerAccount}>Create account</button>
            <button className="wideBtn" onClick={() => navigate("home")}>Back to home</button>
          </div>
        </section>
      )}

      {page === "login" && (
        <section key="login-page" className="account authPageTransition">
          <div className="card accountCard">
            <div className="accountBadge">WELCOME BACK</div>
            <label>UPI BILLS LOGIN</label><h1>Login</h1>
            <p>Your login form also stays on this page after an accidental refresh.</p>
            <div className="formStack loginFormStack">
              <label className={loginErrors.email ? "fieldError" : ""}>Email address
                <input value={login.email} aria-invalid={!!loginErrors.email} type="email" placeholder="you@example.com" onChange={e => { setLogin({ ...login, email: e.target.value }); setLoginErrors(old => ({ ...old, email: "" })); setLoginCredentialError(""); }} />
                {loginErrors.email && <span className="fieldErrorMessage">{loginErrors.email}</span>}
              </label>
              <label className={loginErrors.password ? "fieldError" : ""}>Password
                <div className="passwordInputWrap">
                  <input value={login.password} aria-invalid={!!loginErrors.password} type={showLoginPassword ? "text" : "password"} placeholder="Your password" onChange={e => { setLogin({ ...login, password: e.target.value }); setLoginErrors(old => ({ ...old, password: "" })); setLoginCredentialError(""); }} />
                  <button
                    type="button"
                    className="passwordToggle"
                    onClick={() => setShowLoginPassword(old => !old)}
                    aria-label={showLoginPassword ? "Hide password" : "Show password"}
                  >
                    {showLoginPassword ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.4A10.9 10.9 0 0 1 12 4.2c5.2 0 9.2 3.3 10.5 7.8a11.7 11.7 0 0 1-3 5.1M6.2 6.2C4.4 7.5 2.8 9.5 1.5 12 2.8 16.5 6.8 19.8 12 19.8c1.2 0 2.3-.2 3.3-.5" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                  </button>
                </div>
                {loginErrors.password && <span className="fieldErrorMessage">{loginErrors.password}</span>}
                {loginCredentialError && <span className="loginCredentialError">{loginCredentialError}</span>}
              </label>
            </div>
            <button className="primary accountSubmit" onClick={loginAccount}>Login</button>
            <button className="newAccountPrompt" onClick={() => navigate("account")}>
              New here? <strong>Create an account now</strong>
            </button>
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
            <button className="wideBtn" onClick={() => navigate("dashboard", true)}>Back to dashboard</button>
            <button className="wideBtn" onClick={logout}>Logout</button>
          </div>
        </section>
      )}

      {page === "dashboard" && profile && (
        <section className="dashboardPage">
          <div className="dashboardHero">
            <div><div className="eyebrow"><span>●</span> UPI BILLS <b>DASHBOARD</b></div><h1>Welcome back, {profile.name.split(" ")[0]}.</h1><p>Manage your bills, track payments, and pay bills shared with you.</p></div>
          </div>
          <div className="dashboardStats"><div><strong>{dashboardStats.created}</strong><span>Bills created</span></div><div><strong>{dashboardStats.pending}</strong><span>Pending</span></div><div><strong>₹{money(dashboardStats.received)}</strong><span>Received</span></div><div><strong>₹{money(dashboardStats.owing)}</strong><span>To pay</span></div></div>
          <div className="dashboardOptions">
            <button className="dashboardOption create" onClick={() => navigate("product")}><span className="dashboardIcon">＋</span><strong>Create Bill</strong><small>Create a bill against other registered members.</small><b>Open →</b></button>
            <button className="dashboardOption" onClick={openMyBills}><span className="dashboardIcon">↗</span><strong>My Bills</strong><small>View bills you created and mark them pending or received.</small><b>View bills →</b></button>
            <button className="dashboardOption" onClick={openOtherBills}><span className="dashboardIcon">↓</span><strong>Others Bills</strong><small>View bills created by others for you and pay them.</small><b>View bills →</b></button>
          </div>
        </section>
      )}

      {page === "mine" && profile && (
        <section className="historyPage">
          <div className="historyHeader">
            <div><div className="eyebrow"><span>●</span> UPI BILLS <b>MY BILLS</b></div><h1>My bills</h1><p>Bills you created. Track every payment manually.</p></div>
            <div className="historyHeaderActions">
              <button className="secondary" onClick={refreshMyBills} disabled={dataLoading.mine} aria-busy={dataLoading.mine}>
                <span className={dataLoading.mine ? "buttonSpinner" : ""} aria-hidden="true">{dataLoading.mine ? "" : "↻"}</span>
                {dataLoading.mine ? "Refreshing..." : "Refresh"}
              </button>
              <button className="primary" onClick={() => navigate("product")}>Create bill</button>
            </div>
          </div>
          <div className="billToolbar">
            <input placeholder="Search bills, people or items..." value={billSearch} onChange={e=>setBillSearch(e.target.value)} />
            <div className="filterPills">{(["all","pending","received"] as const).map(f=><button key={f} className={(myBillFilter||"all")===f?"active":""} onClick={()=>setMyBillFilter(f)}>{f==="all"?"All":f==="pending"?"Pending":"Received"}</button>)}</div>
          </div>
          {!dataLoaded.mine ? <div className="historyList historySkeletonList" aria-label="Loading bills" aria-busy="true">{[1,2,3].map(i=><div className="card historyCardSkeleton" key={i}><div className="skeletonLine skeletonStatus"/><div className="skeletonLine skeletonTitle"/><div className="skeletonLine skeletonMeta"/><div className="skeletonDivider"/><div className="skeletonLine skeletonItem"/><div className="skeletonLine skeletonItem short"/></div>)}</div> :
          dataError.mine ? <div className="card historyEmpty historyErrorState"><span className="historyStateIcon">!</span><h2>We couldn’t load your bills</h2><p>{dataError.mine}</p><button className="primary" onClick={()=>refreshMyBills()}>Try again</button></div> :
          !myBills.length ? <div className="card historyEmpty"><span className="historyStateIcon">＋</span><h2>No bills created yet</h2><p>Create your first bill and it will appear here.</p><button className="primary" onClick={()=>navigate("product")}>Create a bill →</button></div> :
          <div className="historyList">{myBills.filter((bill:any)=>{
            const q=billSearch.toLowerCase().trim();
            const text=[bill.id,...(bill.recipients||[]).map((r:any)=>r.name),...(bill.items||[]).map((x:any)=>x.name)].join(" ").toLowerCase();
            return (myBillFilter==="all"||bill.paymentStatus===myBillFilter)&&(!q||text.includes(q));
          }).map((bill:any)=><div className="card historyCard" key={bill.id}>
            <div className="historyCardTop"><div><span className={"alertStatus "+(bill.paymentStatus==="received"?"paid":"pending")}>● {bill.paymentStatus==="received"?"PAYMENT RECEIVED":"PAYMENT PENDING"}</span><h2>Bill to {(bill.recipients||[]).map((r:any)=>r.name).join(", ")}</h2><div className="historySummary"><span>{(bill.items||[]).length} items</span><span>·</span><span>{bill.recipients?.length||0} recipients</span><span>·</span><span>Created {new Date(bill.createdAt).toLocaleDateString("en-IN",{dateStyle:"medium"})}</span></div></div><strong>₹{money(Number(bill.totalAmount))}</strong></div>
            <div className="historyCardActions"><button className="secondary" onClick={()=>setOpenBillId(openBillId===bill.id?null:bill.id)}>{openBillId===bill.id?"Hide details":"View details"}</button><button className="primary" onClick={()=>updateMyBillStatus(bill.id,"received")} disabled={bill.paymentStatus==="received"}>✓ Mark Received</button></div>
            {openBillId===bill.id&&<div className="billDetailPanel"><div className="detailSectionTitle">Items</div>{(bill.items||[]).map((item:any)=><div key={item.id}><span>{item.name}</span><strong>₹{money(Number(item.amount))}</strong></div>)}<div className="detailSectionTitle">Recipient shares</div>{(bill.recipients||[]).map((r:any)=><div key={r.id}><span>{r.name}</span><strong>₹{money(Number(r.amount)||Number(bill.totalAmount)/(bill.recipients?.length||1))}</strong></div>)}<div className="historyDetailActions"><button className="secondary" onClick={()=>updateMyBillStatus(bill.id,"pending")} disabled={bill.paymentStatus==="pending"}>Mark Pending</button><button className="secondary dangerAction" onClick={()=>deleteMyBill(bill.id)}>Delete</button></div></div>}
          </div>)}</div>}
        </section>
      )}

      {page === "others" && profile && (
        <section className="historyPage">
          <div className="historyHeader"><div><div className="eyebrow"><span>●</span> UPI BILLS <b>OTHERS' BILLS</b></div><h1>Others' bills</h1><p>Bills created by other members for you.</p></div><div className="historyHeaderActions">
              <button className="secondary" onClick={refreshOtherBills} disabled={dataLoading.others} aria-busy={dataLoading.others}>
                <span className={dataLoading.others ? "buttonSpinner" : ""} aria-hidden="true">{dataLoading.others ? "" : "↻"}</span>
                {dataLoading.others ? "Refreshing..." : "Refresh"}
              </button>
            </div></div>
          <div className="billToolbar">
            <input placeholder="Search bills, creators or items..." value={billSearch} onChange={e=>setBillSearch(e.target.value)} />
            <div className="filterPills">{(["all","pending","received"] as const).map(f=><button key={f} className={(otherBillFilter||"all")===f?"active":""} onClick={()=>setOtherBillFilter(f)}>{f==="all"?"All":f==="pending"?"Pending":"Received"}</button>)}</div>
          </div>
          {!dataLoaded.others ? <div className="historyList historySkeletonList" aria-label="Loading bills" aria-busy="true">{[1,2,3].map(i=><div className="card historyCardSkeleton" key={i}><div className="skeletonLine skeletonStatus"/><div className="skeletonLine skeletonTitle"/><div className="skeletonLine skeletonMeta"/><div className="skeletonDivider"/><div className="skeletonLine skeletonItem"/><div className="skeletonLine skeletonItem short"/></div>)}</div> :
          dataError.others ? <div className="card historyEmpty historyErrorState"><span className="historyStateIcon">!</span><h2>We couldn’t load shared bills</h2><p>{dataError.others}</p><button className="primary" onClick={()=>refreshOtherBills()}>Try again</button></div> :
          !otherBills.length?<div className="card historyEmpty"><span className="historyStateIcon">↓</span><h2>No bills for you</h2><p>When another member creates a bill for you, it will appear here.</p></div>:
          <div className="historyList">{otherBills.filter((bill:any)=>{
            const q=billSearch.toLowerCase().trim();
            const text=[bill.id,bill.creatorName,...(bill.items||[]).map((x:any)=>x.name)].join(" ").toLowerCase();
            return (otherBillFilter==="all"||bill.paymentStatus===otherBillFilter)&&(!q||text.includes(q));
          }).map((bill:any)=>{
            const amount=Number(bill.recipientAmount)||Number(bill.totalAmount)/(bill.recipientCount||1);
            const link=makePaymentLink(bill.creatorUpi,bill.creatorName,amount);
            return <div className="card historyCard" key={bill.id}>
              <div className="historyCardTop"><div><span className={"alertStatus "+(bill.paymentStatus==="received"?"paid":"pending")}>● {bill.paymentStatus==="received"?"PAYMENT RECEIVED":"PAYMENT PENDING"}</span><h2>From {bill.creatorName}</h2><div className="historySummary"><span>{(bill.items||[]).length} items</span><span>·</span><span>{bill.recipients?.length||1} recipients</span><span>·</span><span>Created {new Date(bill.createdAt).toLocaleDateString("en-IN",{dateStyle:"medium"})}</span></div></div><strong>₹{money(amount)}</strong></div>
              <div className="historyCardActions"><button className="secondary" onClick={()=>setOpenBillId(openBillId===bill.id?null:bill.id)}>{openBillId===bill.id?"Hide details":"View details"}</button><button className="primary" onClick={()=>window.location.href=link} disabled={bill.paymentStatus==="received"}>Pay now ↗</button></div>
              {openBillId===bill.id&&<div className="billDetailPanel"><div className="detailSectionTitle">Items</div>{(bill.items||[]).map((item:any)=><div key={item.id}><span>{item.name}</span><strong>₹{money(Number(item.amount))}</strong></div>)}<div className="detailSectionTitle">Payment</div><div><span>Created by</span><strong>{bill.creatorName}</strong></div><div><span>Pay to</span><strong>{bill.creatorUpi}</strong></div><div><span>Your share</span><strong>₹{money(amount)}</strong></div><div className="othersPaymentArea"><div className="othersQr"><QRCodeSVG value={link} size={170} level="M"/><small>Scan with any UPI app<br/>Your share: ₹{money(amount)}</small></div></div></div>}
            </div>
          })}</div>}
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
                <div className="sectionTitle"><div><b>1</b><div><h2>Select members</h2><small>Choose who needs to pay.</small></div></div><span>{selected.length ? `${selected.length} ${selected.length === 1 ? "member" : "members"} selected` : "No members selected"}</span></div>
                {billValidationError && !selected.length && <div className="billInlineError" role="alert"><span>!</span><div><strong>Check your members</strong><small>{billValidationError}</small></div></div>}
                {members.length ? <>
                  {members.length >= 5 && <div className="memberSearch"><span aria-hidden="true">⌕</span><input aria-label="Search members" placeholder="Search members..." value={memberSearch} onChange={e => setMemberSearch(e.target.value)} /><button type="button" onClick={() => setMemberSearch("")} aria-label="Clear member search" style={{display:memberSearch?"inline-flex":"none"}}>×</button></div>}
                  {selected.length > 0 && <div className="selectedMemberChips"><small>SELECTED</small><div>{selectedMembers.map(member => <button type="button" key={member.id} onClick={() => toggleMember(member.id)} aria-label={`Remove ${member.name}`}><span>{member.name}</span><b>×</b></button>)}</div></div>}
                  {(() => {
                    const query = memberSearch.trim().toLowerCase();
                    const filteredMembers = members.filter(member => !query || member.name.toLowerCase().includes(query) || member.upi.toLowerCase().includes(query));
                    return <div className="registeredList">{filteredMembers.length ? filteredMembers.map(member => (
                      <button type="button" className={"registeredMember " + (selected.includes(member.id) ? "selected" : "")} key={member.id} onClick={() => toggleMember(member.id)} aria-pressed={selected.includes(member.id)}>
                        <span className="memberAvatar">{member.name.charAt(0).toUpperCase()}</span>
                        <span><strong>{member.name}</strong><small>{member.upi}</small></span>
                        <i aria-hidden="true">{selected.includes(member.id) ? "✓" : "○"}</i>
                      </button>
                    )) : <div className="memberSearchEmpty"><strong>No matching members</strong><small>Try a different name or UPI ID.</small></div>}</div>;
                  })()}
                </> : <div className="emptyMembers"><strong>No other registered members yet</strong><small>Create another account to make a member-to-member bill.</small></div>}
              </div>

              <div className="card productCard">
                <div className="sectionTitle"><div><b>2</b><div><h2>Bill details <em>· {items.length} {items.length === 1 ? "item" : "items"}</em></h2><small>Add every item and its exact amount.</small></div></div></div>
                {billValidationError && total <= 0 && selected.length > 0 && <div className="billInlineError" role="alert"><span>!</span><div><strong>Check your bill items</strong><small>{billValidationError}</small></div></div>}
                <div className="billItems">{items.map((item, index) => (
                  <div className="billItem" data-item-id={item.id} key={item.id}>
                    <span>{index + 1}</span>
                    <input
                      data-field="name"
                      value={item.name}
                      placeholder="e.g. Tea"
                      onChange={e => { e.currentTarget.setCustomValidity(""); updateItem(item.id, "name", e.target.value); }}
                    />
                    <div className="itemAmount"><span>₹</span><input
                      data-field="amount"
                      value={item.amount}
                      inputMode="decimal"
                      placeholder="0.00"
                      onChange={e => { e.currentTarget.setCustomValidity(""); updateItem(item.id, "amount", e.target.value); }}
                    /></div>
                    <button onClick={() => { if (items.length === 1) return; setBillCreatedSuccess(false); setBillValidationError(""); setItems(old => old.filter(x => x.id !== item.id)); }} disabled={items.length === 1}>×</button>
                  </div>
                ))}</div>
                <button className="addItem" onClick={() => { setBillCreatedSuccess(false); setBillValidationError(""); setItems(old => [...old, { id: Date.now(), name: "", amount: "" }]); }}>＋ Add another item</button>
                {billValidationError && hasCustomSplit && <div className="billInlineError" role="alert"><span>!</span><div><strong>Check the split</strong><small>{billValidationError}</small></div></div>}
                {selected.length>0 && <div className="splitBox"><div className="splitBoxHead"><div><strong>How should the bill be split?</strong><small>Choose equal shares or enter a custom amount for each member.</small></div></div><div className="splitMode"><button type="button" className={splitMode === "equal" ? "active" : ""} onClick={splitEvenly}>● Split equally</button><button type="button" className={splitMode === "custom" ? "active" : ""} onClick={() => { setSplitMode("custom"); setRecipientAmounts({}); setBillValidationError(""); setBillCreatedSuccess(false); }}>○ Custom amounts</button></div>{selectedMembers.map(m=><label key={m.id}><span>{m.name}</span><div><span>₹</span><input inputMode="decimal" value={recipientAmounts[m.id]||""} placeholder={((Number(displayShareAmounts[m.id]) || 0)).toFixed(2)} onChange={e=>setRecipientAmount(m.id,e.target.value)} /></div></label>)}<small className={Math.abs(displayShareTotal-total)<0.001?"splitGood":"splitWarning"}>{hasCustomSplit ? `Assigned ₹${money(displayShareTotal)} of ₹${money(total)}` : `Equal split · ₹${money(displayShareTotal)} allocated`}</small>{hasCustomSplit && <div className={Math.abs(displayShareTotal-total)<0.001 ? "splitBalance splitGood" : "splitBalance splitWarning"}><span>Total bill <b>₹{money(total)}</b></span><span>Assigned <b>₹{money(displayShareTotal)}</b></span><strong>{Math.abs(displayShareTotal-total)<0.001 ? "✓ Balanced" : `⚠ ₹${money(Math.abs(total-displayShareTotal))} remaining`}</strong></div>}</div>}
                <div className="totalBar"><span>Total amount</span><strong>₹{money(total)}</strong></div>
                <button className="primary generateBtn" onClick={generateBill}>Create Bill →</button>
                {billCreatedSuccess && <div className="billCreatedSuccess" role="status"><span>✓</span><div><strong>Bill created successfully</strong><small>The bill has been added to My Bills.</small></div><button className="secondary" onClick={() => navigate("mine")}>View My Bills →</button></div>}
              </div>
            </div>

            <aside className="productSide">
              <div className="card previewCard">
                <span className="live">● BILL PREVIEW</span>
                <h2>{items.filter(i => i.name.trim()).map(i => i.name).join(" + ") || "Your bill items"}</h2>
                <div className="previewTotal">₹{money(total)}</div>
                <small>Paid to</small><strong>{profile.name}</strong><span>{profile.upi}</span>
                {selectedMembers.length > 0 && <div className="selectedPayers"><small>Bill for</small>{selectedMembers.map(m => <div key={m.id}><span>{m.name}</span><b>{hasCustomSplit && !recipientAmounts[m.id] ? "—" : "₹" + money(Number(displayShareAmounts[m.id]) || 0)}</b></div>)}</div>}
                <div className="secureNote">✓ Payments go to the bill creator's registered UPI ID.</div>
              </div>
            </aside>
          </div>

        </section>
      )}

      {existingAccount && (
        <div className="accountModalOverlay" onClick={() => setExistingAccount(false)}>
          <div className="accountModal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <button className="accountModalClose" onClick={() => setExistingAccount(false)} aria-label="Close">×</button>
            <div className="accountModalIcon">!</div>
            <span className="live">ACCOUNT EXISTS</span>
            <h2>Existing account found</h2>
            <p>{existingAccountMessage}</p>
            <div className="accountModalActions">
              <button className="primary" onClick={() => { setExistingAccount(false); navigate("login"); }}>Go to Login →</button>
              <button className="wideBtn" onClick={() => { setExistingAccount(false); setExistingAccountMessage("An account already exists with one or more of these details."); }}>Stay here</button>
            </div>
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
      {toast && <ToastNotification message={toast} type={toastType} />}
    </main>
  );
}
