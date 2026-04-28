"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { useEffect, useState } from "react";
import { getClientAuth } from "../firebase/client";

export interface AuthState {
  user: User | null;
  loading: boolean;
}

export function useAuthUser(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    const unsub = onAuthStateChanged(getClientAuth(), (user) => {
      setState({ user, loading: false });
    });
    return unsub;
  }, []);

  return state;
}
