import { createFileRoute } from "@tanstack/react-router";

import { CooDashboard } from "../components/coo/CooDashboard";

export const Route = createFileRoute("/_chat/coo")({
  component: CooDashboard,
});
