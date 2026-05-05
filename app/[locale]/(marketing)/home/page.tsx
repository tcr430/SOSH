import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function MarketingHomePage() {
  const t = useTranslations("marketing.hero");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-7xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-4 max-w-xl text-xl text-muted-foreground">{t("subtitle")}</p>
      <Link href="signup" className={cn(buttonVariants({ size: "lg" }), "mt-10")}>
        {t("cta")}
      </Link>
    </main>
  );
}
