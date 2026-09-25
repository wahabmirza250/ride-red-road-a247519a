import { createFileRoute } from "@tanstack/react-router";
import { PassengerSignInScreen } from "@/components/auth/PassengerSignInScreen";
export const Route = createFileRoute("/passenger/signin")({ component: PassengerSignInScreen });
