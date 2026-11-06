import { type ActionFunctionArgs } from "react-router";
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
    return Response.json(
      { error: "Unsupported language" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return Response.json(
    { locale },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Set-Cookie": await localeCookie(session.shop).serialize(locale),
      },
    },
  );
}
