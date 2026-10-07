import { RoomView } from "@/components/room";
export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const adminView = (await searchParams).view === "admin";
  return <RoomView key={`${id}:${adminView}`} roomId={id} adminView={adminView} />;
}
