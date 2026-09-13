"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/auth-context";
import { DEMO_CREDENTIALS } from "@/lib/mock/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/shared/page-states";
import { BrandLogo } from "@/components/layout/brand-logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginForm = z.infer<typeof loginSchema>;

const demoAccounts = [
  { role: "Admin", email: DEMO_CREDENTIALS.email, password: DEMO_CREDENTIALS.password },
  {
    role: "Operator",
    email: DEMO_CREDENTIALS.operatorEmail,
    password: DEMO_CREDENTIALS.operatorPassword,
  },
  {
    role: "Viewer",
    email: DEMO_CREDENTIALS.viewerEmail,
    password: DEMO_CREDENTIALS.viewerPassword,
  },
];

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  async function onSubmit(values: LoginForm) {
    setSubmitting(true);
    const result = await login(values.email, values.password);
    setSubmitting(false);
    if (result.ok) {
      toast.success("Welcome back");
      router.replace("/");
    } else {
      toast.error(result.error ?? "Login failed");
    }
  }

  if (loading || user) {
    return (
      <div className="app-aurora min-h-screen">
        <LoadingState className="min-h-screen" />
      </div>
    );
  }

  return (
    <div className="app-aurora relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle variant="outline" />
      </div>

      <div className="page-enter w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-start">
          <BrandLogo size="md" className="mb-5" />
          <span className="eyebrow">MSGate · Health cockpit</span>
          <h1 className="font-display mt-2 text-[40px] leading-[1.02] text-slate-900 dark:text-slate-50">
            Welcome <span className="italic">back.</span>
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
            Cockpit opérationnel — pilote le backend (Airtable, LLC, recovery).
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-[12px] text-slate-600 dark:text-slate-400">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@msgate.internal"
              className="h-11 rounded-2xl px-4"
              {...register("email")}
            />
            {errors.email ? (
              <p className="text-xs text-rose-600">{errors.email.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-[12px] text-slate-600 dark:text-slate-400">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className="h-11 rounded-2xl px-4"
              {...register("password")}
            />
            {errors.password ? (
              <p className="text-xs text-rose-600">{errors.password.message}</p>
            ) : null}
          </div>

          <Button type="submit" size="lg" className="h-11 w-full rounded-2xl" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                Sign in
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        {/* Les comptes de démonstration n'existent qu'en développement : en production, seuls les comptes de AUTH_USERS se connectent. */}
        {process.env.NODE_ENV === "production" ? null : (
        <div className="mt-8 border-t border-slate-200/80 pt-5 dark:border-slate-800">
          <div className="eyebrow mb-2.5">Demo accounts · click to fill</div>
          <div className="space-y-1.5">
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => {
                  setValue("email", account.email);
                  setValue("password", account.password);
                }}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-left text-xs transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-950/60 dark:hover:bg-slate-900"
              >
                <span className="font-medium text-slate-800 dark:text-slate-100">{account.role}</span>
                <span className="font-mono text-[10px] text-slate-500">
                  {account.email} / {account.password}
                </span>
              </button>
            ))}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
