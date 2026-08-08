import { createFileRoute } from "@tanstack/react-router";
import { DispatchSignInScreen } from "@/components/auth/DispatchSignInScreen";

export const Route = createFileRoute("/dispatch/signin")({
  component: DispatchSignInScreen,
});
