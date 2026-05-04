import { Redirect, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth";

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hydrate = useAuthStore((s) => s.hydrate);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    hydrate();
    setHasHydrated(true);
  }, [hydrate]);

  if (!hasHydrated) return <Stack screenOptions={{ headerShown: false }} />;

  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;

  return (
    <Stack
      screenOptions={{ headerShown: false }}
    />
  );
}
