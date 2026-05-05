import Image from "next/image";
import { Suspense } from "react";
import BackLink from "@/components/BackLink";
import SignInForm from "../sign-in/sign-in-form";

export const metadata = {
  title: "Sign up — Indic Religion Guide",
};

export default function SignUpPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-10">
      <BackLink href="/" label="Back to home" />
      <div className="flex flex-col items-center gap-5 rounded-3xl border border-border-warm bg-surface p-8 text-center shadow-sm">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-saffron-soft ring-1 ring-border-strong">
          <Image
            src="/Ornate-Dharma-Wheel.svg"
            alt=""
            width={38}
            height={38}
          />
        </span>
        <h1 className="font-display text-3xl font-semibold text-maroon">
          Create an account
        </h1>
        <p className="text-sm leading-relaxed text-foreground/75">
          An account lets us remember your tradition, region, and language so
          ritual variants come back personalized to you.
        </p>
        <Suspense fallback={null}>
          <SignInForm mode="signup" />
        </Suspense>
      </div>
    </main>
  );
}
