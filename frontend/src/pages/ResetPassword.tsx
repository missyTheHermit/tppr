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
import { useNavigate } from "react-router-dom";

export default function ResetPassword() {
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const navigate = useNavigate();

    async function handleSubmit(e: React.SubmitEvent) {
        e.preventDefault();
        if (password !== confirm) {
            toast.error("Passwords do not match");
            return;
        }
        setSubmitting(true);
        const { error } = await supabase.auth.updateUser({ password });
        setSubmitting(false);
        if (error) {
            toast.error(error.message);
        } else {
            toast.success("Password updated successfully");
            navigate("/login", { replace: true });
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <Card className="w-full max-w-sm">
                <CardHeader className="text-center">
                    <CardTitle>Set New Password</CardTitle>
                    <CardDescription>
                        Enter your new password below.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form
                        onSubmit={handleSubmit}
                        className="flex flex-col gap-4"
                    >
                        <Input
                            type="password"
                            placeholder="New password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                        <Input
                            type="password"
                            placeholder="Confirm password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            required
                        />
                        <Button type="submit" disabled={submitting}>
                        {submitting ? "Updating..." : "Update Password"}
                    </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
