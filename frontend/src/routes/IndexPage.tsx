import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getSession } from "@/lib/api";

export function IndexPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const session = await getSession();
      if (!alive) return;
      navigate({
        to: session ? "/chat" : "/login",
        replace: true,
      });
    };
    void run();
    return () => {
      alive = false;
    };
  }, [navigate]);

  return (
    <div className="loading-screen">
      <div>Opening Jargon…</div>
    </div>
  );
}
