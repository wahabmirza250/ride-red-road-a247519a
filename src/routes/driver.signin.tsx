import { createFileRoute } from "@tanstack/react-router";
import { DriverSignInScreen } from "@/components/auth/DriverSignInScreen";

export const Route = createFileRoute("/driver/signin")({
  component: DriverSignInScreen,
});
