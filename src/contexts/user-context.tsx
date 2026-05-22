"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { type User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { toSubscription, type Subscription } from "@/lib/subscription";

interface UserContextType {
  user: User | null;
  householdId: string | null;
  subscription: Subscription | null;
  loading: boolean;
  refreshSubscription: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  user: null,
  householdId: null,
  subscription: null,
  loading: true,
  refreshSubscription: async () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  // remountKey：切回前台时 +1，作为子树 React key 强制所有 client 子页面
  // remount + 重新跑 useEffect（应对浏览器 freeze tab 导致 pending fetch
  // 永远不 resolve、子页面卡转圈圈的问题）
  const [remountKey, setRemountKey] = useState(0);
  const router = useRouter();
  const initRef = useRef(false);
  // 单飞锁：防止 getSession + onAuthStateChange("SIGNED_IN") 并发调用 ensureHousehold
  // 之前没锁导致每次刷新都新建 household，user 累积 30+ 个"我的家庭组"
  // 关联 bug 修复 commit 见 git blame
  const ensuringRef = useRef<Promise<void> | null>(null);
  // visibility 切换时限频，避免用户频繁 alt-tab 触发过多 refetch
  const lastVisRefreshRef = useRef(0);

  const fetchSubscription = async (userId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("subscriptions")
      .select("plan, source, started_at, expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    setSubscription(toSubscription(data));
  };

  const refreshSubscription = async () => {
    if (user) await fetchSubscription(user.id);
  };

  useEffect(() => {
    // 守卫：避免 React 19 StrictMode 双重 effect 触发
    // supabase 客户端的 storage lock 在并发 getSession 下会死锁
    if (initRef.current) return;
    initRef.current = true;

    const supabase = createClient();

    const ensureHousehold = async (userId: string) => {
      // 单飞锁：已有 in-flight 就复用，不并发跑两次
      if (ensuringRef.current) {
        await ensuringRef.current;
        return;
      }
      ensuringRef.current = (async () => {
        // 用 limit(1) + order，避免 maybeSingle 在多行时报错触发误判
        // 之前 bug：maybeSingle 多行时返回 error 但代码只取了 data 字段
        // → membership 为 null → 又 insert → 越积越多
        // 取最早的那条作为权威 household（数据迁移脚本同样规则）
        const { data: members, error: memberErr } = await supabase
          .from("household_members")
          .select("household_id, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(1);

        if (memberErr) {
          console.error("[UserCtx] household_members query error:", memberErr);
          // 查询失败时绝不 insert，避免脏数据
          return;
        }

        if (members && members.length > 0) {
          setHouseholdId(members[0].household_id);
          return;
        }

        // 真的没有 → insert（应用层 + DB unique(owner_id) 双重防护）
        const { data: household, error } = await supabase
          .from("households")
          .insert({ name: "我的家庭组", owner_id: userId })
          .select("id")
          .single();

        if (error || !household) {
          if (error) {
            console.error("[UserCtx] household insert error:", error);
            // 可能 DB unique 冲突 → 再查现有的
            const { data: retry } = await supabase
              .from("households")
              .select("id")
              .eq("owner_id", userId)
              .order("created_at", { ascending: true })
              .limit(1);
            if (retry && retry[0]) setHouseholdId(retry[0].id);
          }
          return;
        }

        const { error: memberInsertErr } = await supabase
          .from("household_members")
          .insert({ household_id: household.id, user_id: userId, role: "owner" });

        if (memberInsertErr) console.error("[UserCtx] member insert error:", memberInsertErr);
        setHouseholdId(household.id);
      })();
      try {
        await ensuringRef.current;
      } finally {
        ensuringRef.current = null;
      }
    };

    // 5 秒兜底：getSession 卡住也强制释放 loading
    const timeoutId = setTimeout(() => {
      console.warn("[UserCtx] init timeout 5s, releasing loading");
      setLoading(false);
    }, 5000);

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        clearTimeout(timeoutId);
        const u = data?.session?.user ?? null;
        setUser(u);
        setLoading(false);
        if (u) {
          try {
            await Promise.all([
              ensureHousehold(u.id),
              fetchSubscription(u.id),
            ]);
          } catch (err) {
            console.error("[UserCtx] post-init error:", err);
          }
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.error("[UserCtx] init exception:", err);
        setLoading(false);
      }
    })();

    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setHouseholdId(null);
        setSubscription(null);
      } else if (event === "SIGNED_IN" && session?.user) {
        setUser(session.user);
        Promise.all([
          ensureHousehold(session.user.id),
          fetchSubscription(session.user.id),
        ]).catch((err) =>
          console.error("[UserCtx] post SIGNED_IN error:", err)
        );
      }
    });

    // 切回前台时的恢复策略（应对手机浏览器后台 freeze tab 导致页面卡死）
    // 四层防御：
    // 1. 强制释放 UserContext loading 状态（如果还卡着）
    // 2. 重新 getSession（自动 refresh expired token）
    // 3. router.refresh() 触发 server components 重新 fetch
    // 4. remountKey +1 强制所有 client 子页面 unmount + remount，
    //    丢弃 freeze 中残留的 pending fetch，重新跑 useEffect 拉数据
    // 用 30 秒限频避免频繁 alt-tab 拖慢应用
    //
    // ⚠️ 重要：第 3、4 步会摧毁正在填的表单。iOS 用户「填租约填一半 →
    // 切出去查个电话 → 切回来」是高频动作，如果这时 remount，弹窗会关掉、
    // 填的内容全没。所以检测到页面有打开的弹窗时，只做 1+2，跳过 3+4。
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVisRefreshRef.current < 30_000) return;
      lastVisRefreshRef.current = now;

      // 1. 释放可能卡住的 loading 状态（这步不破坏表单，照常做）
      setLoading((prev) => {
        if (prev) console.warn("[UserCtx] released stuck loading on visibility");
        return false;
      });

      // 2. 静默 refresh session（token 过期时会自动续期，不破坏表单）
      supabase.auth.getSession().catch(() => {});

      // 有弹窗打开（用户正在填表单）→ 跳过 refresh + remount，保住填到一半的内容
      const hasOpenDialog = document.querySelector(
        '[role="dialog"],[role="alertdialog"]'
      );
      if (hasOpenDialog) {
        console.warn("[UserCtx] dialog open, skip refresh+remount to keep form");
        return;
      }

      // 3. 触发 Next.js Server Components 重新 fetch
      router.refresh();

      // 4. 强制 client 子页面 remount，避免 fetch 被 freeze 卡住转圈不刷
      setRemountKey((k) => k + 1);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    void authSub;
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      authSub.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <UserContext.Provider value={{ user, householdId, subscription, loading, refreshSubscription }}>
      {/*
        用 remountKey 作为 React key 包裹 children——切回前台时 key 变化，
        所有 client 子页面整棵子树 unmount + remount，所有 useEffect 重新跑，
        丢弃 freeze 中残留的 pending fetch。
        UserContext value 不受影响（user/householdId 不会重置）。
      */}
      <React.Fragment key={remountKey}>{children}</React.Fragment>
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
