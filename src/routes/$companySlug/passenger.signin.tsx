import { createFileRoute } from "@tanstack/react-router";
import { PassengerSignInScreen } from "@/components/auth/PassengerSignInScreen";
export const Route = createFileRoute("/$companySlug/passenger/signin")({ ssr: false, component: PassengerLogin });
function PassengerLogin() { const { companySlug } = Route.useParams(); return <PassengerSignInScreen companySlug={companySlug} />; }
