import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { SUPPORTED_LOCALES, type AppLocale } from "../utils/i18n-core";
import { localeCookie } from "../utils/i18n.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const locale = (await request.formData()).get("locale");
  if (
    typeof locale !== "string" ||
    !SUPPORTED_LOCALES.includes(locale as AppLocale)
  ) {
    return json(
      { error: "Unsupported language" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return json(
    { locale },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Set-Cookie": await localeCookie(session.shop).serialize(locale),
      },
    },
  );
}
