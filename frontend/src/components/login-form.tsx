import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Input } from "@/components/ui/input";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { safeRedirectPath, signupPath } from "@/lib/routes";
import { supabase } from "@/lib/supabase";

export function LoginForm(
  { className, ...props }: React.ComponentProps<"div">,
) {
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));

  const [mfaFactorId, setMfaFactorId] = useState("");
  const [mfaChallengeId, setMfaChallengeId] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [showMfa, setShowMfa] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    setSigningIn(true);
    const { error: signInError } = await supabase.auth.signInWithPassword(
      { email, password },
    );
    setSigningIn(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }

    const { data: factors } = await supabase.auth.mfa.listFactors();
    if (factors?.totp && factors.totp.length > 0) {
      const factor = factors.totp[0];
      const { data: challenge, error: chalErr } = await supabase.auth.mfa
        .challenge({ factorId: factor.id });
      if (chalErr) {
        setError(chalErr.message);
        return;
      }
      setMfaFactorId(factor.id);
      setMfaChallengeId(challenge.id);
      setShowMfa(true);
      return;
    }

    toast.success("Signed in successfully");
    navigate(redirectTo);
  }

  async function handleMfaVerify() {
    setVerifying(true);
    const { error } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: mfaChallengeId,
      code: mfaCode,
    });
    setVerifying(false);
    if (error) {
      setError(error.message);
      return;
    }
    toast.success("Signed in successfully");
    navigate(redirectTo);
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: new URL(redirectTo, window.location.origin).toString(),
      },
    });
    setGoogleLoading(false);
    if (error) {
      setError(error.message);
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>
            Login with your email or Google account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            {showMfa
              ? (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="mfa-code">
                      Enter your 2FA code
                    </FieldLabel>
                    <InputOTP
                      id="mfa-code"
                      maxLength={6}
                      value={mfaCode}
                      onChange={(value) => setMfaCode(value)}
                      autoFocus
                      onComplete={handleMfaVerify}
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </Field>
                  <Field>
                    {error && (
                      <p className="text-sm text-destructive">{error}</p>
                    )}
                    <Button type="button" onClick={handleMfaVerify} disabled={verifying}>
                      {verifying ? "Verifying..." : "Verify"}
                    </Button>
                  </Field>
                </FieldGroup>
              )
              : (
                <FieldGroup>
                  <Field>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={googleLoading || signingIn}
                    >
                      {googleLoading ? "Redirecting..." : "Login with Google"}
                    </Button>
                  </Field>
                  <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                    or continue with
                  </FieldSeparator>
                  <Field>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input
                      id="email"
                      name="email"
                      type="text"
                      placeholder="4tkbytes@pm.me"
                      required
                    />
                  </Field>
                  <Field>
                    <div className="flex items-center">
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <Link
                        to="/forgot-password"
                        className="ml-auto text-sm underline-offset-4 hover:text-foreground"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      required
                    />
                  </Field>
                  <Field>
                    {error && (
                      <p className="text-sm text-destructive">{error}</p>
                    )}
                    <Button type="submit" disabled={signingIn || googleLoading}>
                      {signingIn ? "Signing in..." : "Login"}
                    </Button>
                    <FieldDescription className="text-center">
                      Don&apos;t have an account?{" "}
                      <Link to={signupPath(redirectTo)}>Sign up</Link>
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              )}
          </form>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our <a href="#">Terms of Service</a>
        {" "}
        and <a href="#">Privacy Policy</a>.
      </FieldDescription>
    </div>
  );
}
