"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/auth-context";
import { DEMO_CREDENTIALS } from "@/lib/mock/data";
import { MSGATE_ADMIN_URL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <div className="min-h-screen bg-background">
        <LoadingState className="min-h-screen" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center text-center">
          <BrandLogo size="lg" className="mb-3" />
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            MSGate Health
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Cockpit opérationnel — pilote le backend (Airtable, LLC, recovery)
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use your workspace credentials to continue</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@msgate.internal"
                  {...register("email")}
                />
                {errors.email ? (
                  <p className="text-xs text-rose-600">{errors.email.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...register("password")}
                />
                {errors.password ? (
                  <p className="text-xs text-rose-600">{errors.password.message}</p>
                ) : null}
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-emerald-100 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Demo accounts</CardTitle>
            <CardDescription>Click a row to fill the form</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => {
                  setValue("email", account.email);
                  setValue("password", account.password);
                }}
                className="flex w-full items-center justify-between rounded-lg border border-emerald-100 bg-white px-3 py-2 text-left text-xs transition-colors hover:border-emerald-200 hover:bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-slate-950 dark:hover:bg-emerald-950/40"
              >
                <span className="font-medium text-slate-800 dark:text-slate-100">{account.role}</span>
                <span className="font-mono text-[10px] text-slate-500">
                  {account.email} / {account.password}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <a
          href={MSGATE_ADMIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Ouvrir MSGate Admin (factures, ads, refunds)
        </a>
      </div>
    </div>
  );
}
