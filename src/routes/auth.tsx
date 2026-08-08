import { createFileRoute } from "@tanstack/react-router";
import { AdminSignInScreen } from "@/components/auth/AdminSignInScreen";

export const Route = createFileRoute("/auth")({
  component: AdminSignInScreen,
});
