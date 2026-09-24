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
          let activePage: AppPage;
          if (!resolvedPage || resolvedPage === "home" || resolvedPage === "login" || resolvedPage === "account") {
            activePage = "dashboard";
            setPage(activePage);
            window.history.replaceState({ page: activePage }, "", "/dashboard");
            touchDraftActivity(activePage);
          } else {
            activePage = resolvedPage;
            setPage(activePage);
            touchDraftActivity(activePage);
          }
          await loadMembers();

          // Deep-linked bill pages need their data loaded during startup too.
          // Otherwise a browser refresh leaves the page empty until the user
          // manually presses Refresh.
          if (activePage === "mine") {
            await loadMyBills();
          } else if (activePage === "others") {
            await loadOtherBills();
          } else if (activePage === "dashboard") {
            await refreshDashboardStats();
          }
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