import InvitationAcceptance from "./invitation-acceptance";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  return <InvitationAcceptance token={params.token ?? ""} />;
}
