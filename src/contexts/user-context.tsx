"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
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
  const initRef = useRef(false);
  // 单飞锁：防止 getSession + onAuthStateChange("SIGNED_IN") 并发调用 ensureHousehold
  // 之前没锁导致每次刷新都新建 household，user 累积 30+ 个"我的家庭组"
  // 关联 bug 修复 commit 见 git blame
  const ensuringRef = useRef<Promise<void> | null>(null);

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

    void authSub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <UserContext.Provider value={{ user, householdId, subscription, loading, refreshSubscription }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
