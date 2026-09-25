      setProfileErrors({});
      setProfileSaving(false);
      setProfileMenuOpen(false);
      setAccountMenuOpen(false);
      profileEditOriginalRef.current = null;
      try { sessionStorage.removeItem(DRAFT_KEY); } catch {}

      // Replace the authenticated page instead of leaving it in browser history.
      navigate("home", true);
      pop("Logged out successfully", "success");
    } catch {
      pop("Check your connection and try again.", "error");
    } finally {
      setLoggingOut(false);
    }
  };

  const copyUpiId = async () => {
    if (!profile?.upi) return;
    try {
      await navigator.clipboard.writeText(profile.upi);
      setUpiCopied(true);
      pop("UPI ID copied", "success");
      window.setTimeout(() => setUpiCopied(false), 1800);
    } catch {
      pop("Couldn't copy the UPI ID", "error");
    }
  };

  const updateProfile = async () => {
    if (!profile || profileSaving) return;
    if (!profileEditing) return;
    const errors: Record<string, string> = {};
    const name = profile.name.trim();
    const upi = profile.upi.trim();
    const mobile = profile.mobile.replace(/\D/g, "");
    const email = profile.email.trim();

    if (!currentProfilePassword.trim()) errors.currentPassword = "Current password is required to verify your identity";
    if (!name) errors.name = "Name is required";
    if (!upi) errors.upi = "UPI ID is required";
    else if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,}@[A-Za-z0-9][A-Za-z0-9.-]{1,}$/.test(upi)) errors.upi = "Enter a valid UPI ID (example: name@bank)";
    if (mobile && !/^[6-9]\d{9}$/.test(mobile)) errors.mobile = "Enter a valid 10-digit Indian mobile number";
    if (!email) errors.email = "Email is required";
    else if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = "Enter a valid email address";
    if (profile.password?.trim() && profile.password.trim().length < 6) errors.password = "Password must be at least 6 characters";

    setProfileErrors(errors);
    if (Object.keys(errors).length) {
      const first = Object.keys(errors)[0];
      document.getElementById("profile-" + first)?.focus();
      return pop("Please fix the highlighted profile fields", "error");
    }

    const normalizedProfile = { ...profile, name, upi, mobile, email };
    try {
      setProfileSaving(true);
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalizedProfile.name, upi: normalizedProfile.upi, mobile: normalizedProfile.mobile, email: normalizedProfile.email, currentPassword: currentProfilePassword })
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          setCurrentProfilePassword("");
          setProfileErrors(old => ({ ...old, currentPassword: data.error || "Current password is incorrect" }));
        } else {
          setProfileErrors(old => ({ ...old, server: data.error || "Unable to update profile" }));
        }
        return;
      }
      const savedProfile = { ...data.user, password: "" };
      setProfile(savedProfile);
      profileEditOriginalRef.current = savedProfile;
      setProfileErrors({});
      resetProfileSaveVerification();
      setProfileEditing(false);
      await loadMembers();
      pop("Profile updated successfully", "success");
    } catch { pop("Unable to update profile", "error"); }
    finally { setProfileSaving(false); }
  };

  const resetProfileSaveVerification = () => {
    setCurrentProfilePassword("");
    setShowCurrentProfilePassword(false);
    setProfileErrors(old => {
      const next = { ...old };
      delete next.currentPassword;
      delete next.server;
      return next;
    });
    setProfileSaveConfirmOpen(false);
  };

  const requestProfileSave = () => {
    if (!profileEditing || profileSaving) return;
    const original = profileEditOriginalRef.current;
    if (original && JSON.stringify({ ...profile, password: "" }) === JSON.stringify({ ...original, password: "" })) {
      return pop("No changes to save", "info");
    }

    if (!profile) return;
    const upi = profile.upi.trim().toLowerCase();
    if (!upi) {
      setProfileErrors(old => ({ ...old, upi: "UPI ID is required" }));
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,}@[A-Za-z0-9][A-Za-z0-9.-]{1,}$/.test(upi)) {
      setProfileErrors(old => ({ ...old, upi: "Enter a valid UPI ID (example: name@bank)" }));
      return;
    }

    setProfileErrors(old => ({ ...old, upi: "", server: "" }));
    resetProfileSaveVerification();
    setProfileSaveConfirmOpen(true);
  };

  const changePassword = async () => {
    if (changePasswordSaving) return;
    const errors: Record<string, string> = {};
    const current = changeCurrentPassword.trim();
    const next = changeNewPassword.trim();
    const confirm = changeConfirmPassword.trim();

    if (!current) errors.current = "Current password is required";
    if (!next) errors.newPassword = "New password is required";
    else if (next.length < 6) errors.newPassword = "New password must be at least 6 characters";
    if (!confirm) errors.confirmPassword = "Please confirm your new password";