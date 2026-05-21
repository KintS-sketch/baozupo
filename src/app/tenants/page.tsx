"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * 反馈 #8: 租客模块合并到租约页面。
 * 旧的 /tenants 入口保留只为兼容老链接、书签、首页旧引用 — 一进来直接跳到 /leases。
 *
 * 注意：tenants 表本身不动（租约和邀请箱仍然依赖），只是这个独立页面不再展示。
 * 如果真的需要老的 CRUD UI，git 历史里 e6501dd 之前还能找到。
 */
export default function TenantsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/leases");
  }, [router]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center space-y-3">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          租客信息已合并到「租约管理」，正在跳转...
        </p>
      </div>
    </div>
  );
}
