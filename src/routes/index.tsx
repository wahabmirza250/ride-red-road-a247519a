import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { loading, user, isAdmin, isDriver } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (user && isAdmin) return <Navigate to="/dashboard" />;
  if (user && isDriver) return <Navigate to="/driver" />;
  return <Navigate to="/passenger" />;
}
