import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Link } from "react-router-dom";

export default function ForgotPassword() {
    const [email, setEmail] = useState("");
    const [sent, setSent] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(e: React.SubmitEvent) {
        e.preventDefault();
        setSubmitting(true);
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        });
        setSubmitting(false);
        if (error) {
            toast.error(error.message);
        } else {
            toast.success(`Reset link sent to ${email}`);
            setSent(true);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <Card className="w-full max-w-sm">
                <CardHeader className="text-center">
                    <CardTitle>Reset Password</CardTitle>
                    <CardDescription>
                        {sent
                            ? "Check your email for a reset link."
                            : "Enter your email to receive a password reset link."}
                    </CardDescription>
                </CardHeader>
                {!sent && (
                    <CardContent>
                        <form
                            onSubmit={handleSubmit}
                            className="flex flex-col gap-4"
                        >
                            <Input
                                type="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                            <Button type="submit" disabled={submitting}>
                                {submitting ? "Sending..." : "Send Reset Link"}
                            </Button>
                            <Link
                                to="/login"
                                className="text-xs text-muted-foreground text-center hover:text-foreground"
                            >
                                Back to login
                            </Link>
                        </form>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}
