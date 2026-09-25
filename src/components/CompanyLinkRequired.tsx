import { CompanyEntry } from "@/components/auth/CompanyEntry";
export function CompanyLinkRequired({ title, message }: { title?: string; message?: string }) {
  return <CompanyEntry title={title} message={message} />;
}
