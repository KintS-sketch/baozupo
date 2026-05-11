"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Sparkles, MessageCircle, Calculator, Download, UsersRound, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useUser } from "@/contexts/user-context";
import { isProActive, PRICING_TIERS, type PricingTier } from "@/lib/subscription";
import { toast } from "sonner";

const PRO_FEATURES = [
  { icon: Building2, label: "无限房源", desc: "免费版仅限 2 套" },
  { icon: MessageCircle, label: "微信自动提醒", desc: "收租日 / 抄表 / 合同到期主动推送，不再忘事" },
  { icon: UsersRound, label: "家庭组无限成员", desc: "免费版限 3 人" },
  { icon: Calculator, label: "个税 Pro 报告", desc: "自动算税额 + PDF 申报报告，报税季省 2 小时" },
  { icon: Download, label: "Excel 多 sheet 导出", desc: "免费版仅 CSV" },
  { icon: Sparkles, label: "优先客服", desc: "Bug 加急 + 功能建议直通开发" },
];

export default function SubscriptionPage() {
  const { subscription } = useUser();
  const [selectedTier, setSelectedTier] = useState<PricingTier["id"]>("yearly_early_bird");
  const isPro = isProActive(subscription);

  const handleSubscribe = () => {
    toast.info("支付通道正在开发中，可联系客服开通早鸟价", {
      duration: 5000,
    });
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-5">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="md:hidden">
          <Button variant="ghost" size="icon" className="h-8 w-8 -ml-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">订阅与升级</h1>
          <p className="text-xs text-muted-foreground">解锁全部 Pro 功能，让管理几套房真正轻松</p>
        </div>
      </div>

      {/* 当前套餐 */}
      <Card className={isPro ? "border-amber-500/40 bg-amber-50/40" : ""}>
        <CardContent className="pt-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">当前套餐</p>
              <p className="text-lg font-bold mt-1 flex items-center gap-2">
                {isPro ? (
                  <>
                    <Sparkles className="h-5 w-5 text-amber-500" />
                    Pro 版
                  </>
                ) : (
                  "免费版"
                )}
              </p>
              {subscription?.expiresAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  到期时间：{new Date(subscription.expiresAt).toLocaleDateString("zh-CN")}
                </p>
              )}
            </div>
            {isPro ? (
              <Badge className="bg-amber-500 hover:bg-amber-500">已是 Pro 用户</Badge>
            ) : (
              <Badge variant="secondary">免费</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {!isPro && (
        <>
          {/* Pro 功能列表 */}
          <Card>
            <CardContent className="pt-5">
              <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                升级 Pro 解锁
              </h2>
              <div className="space-y-3">
                {PRO_FEATURES.map((f) => {
                  const Icon = f.icon;
                  return (
                    <div key={f.label} className="flex items-start gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{f.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
                      </div>
                      <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-1" />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* 套餐选择 */}
          <Card>
            <CardContent className="pt-5">
              <h2 className="text-base font-semibold mb-3">选择套餐</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PRICING_TIERS.map((tier) => {
                  const selected = selectedTier === tier.id;
                  const isEarlyBird = tier.id === "yearly_early_bird";
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => setSelectedTier(tier.id)}
                      className={`relative text-left rounded-xl border-2 p-3 transition-all ${
                        selected
                          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      {tier.badge && (
                        <span className="absolute -top-2 right-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-medium px-2 py-0.5 rounded-full">
                          {tier.badge}
                        </span>
                      )}
                      <p className="text-xs font-medium text-muted-foreground">{tier.label}</p>
                      <p className="text-2xl font-bold mt-1">
                        ¥{tier.priceYuan}
                        {tier.id === "monthly" && (
                          <span className="text-xs font-normal text-muted-foreground">/月</span>
                        )}
                        {tier.id !== "monthly" && (
                          <span className="text-xs font-normal text-muted-foreground">/年</span>
                        )}
                      </p>
                      <p className={`text-[11px] mt-0.5 ${isEarlyBird ? "text-orange-600 font-medium" : "text-muted-foreground"}`}>
                        {tier.perMonthLabel}
                      </p>
                    </button>
                  );
                })}
              </div>

              <Button
                className="w-full mt-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
                onClick={handleSubscribe}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                立即升级
              </Button>

              <p className="text-[11px] text-muted-foreground mt-3 text-center leading-relaxed">
                ⏳ 支付通道正在接入，开通后会通过微信公众号通知你。
                <br />
                急用可联系客服手动开通。
              </p>
            </CardContent>
          </Card>

          {/* 承诺 */}
          <Card className="bg-muted/40">
            <CardContent className="pt-4 pb-4">
              <p className="text-xs font-semibold mb-2">🛡️ 我们的承诺</p>
              <ul className="text-xs text-muted-foreground space-y-1.5">
                <li>· 基础管理 + AI 识别 <strong className="text-foreground">永久免费</strong></li>
                <li>· 数据随时可导出，不绑架你</li>
                <li>· 价格透明，不叠加任何隐藏费用</li>
                <li>· 开通 7 天内未使用任何付费功能，全额退款</li>
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      {isPro && (
        <Card>
          <CardContent className="pt-5">
            <h2 className="text-base font-semibold mb-3">你已享受 Pro 的全部权益</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              感谢你的支持 🌱。你正在使用：
              {subscription?.source === "manual_grant" && "（管理员手动开通）"}
              {subscription?.source === "early_bird" && "早鸟年卡 ¥69"}
              {subscription?.source === "standard" && "标准订阅"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
