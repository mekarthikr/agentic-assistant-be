import { portalRoutes, type PortalRoute } from "@app/config/portal-routes";

export interface PortalNavigationLink {
  readonly title: string;
  readonly url: string;
}

export interface MissingPortalNavigationParameter {
  readonly missingParameter: string;
}

export interface UnsupportedPortalPage {
  readonly unsupportedPage: string;
}

export type PortalNavigationResult =
  | PortalNavigationLink
  | MissingPortalNavigationParameter
  | UnsupportedPortalPage;

const PLACEHOLDER_PATTERN = /\{([^}]+)\}/g;
const PORTAL_DESTINATION_PATTERN =
  /\b(?:how\s+(?:do|can)\s+i\s+(?:open|find)|open|take\s+me\s+to|navigate(?:\s+to)?|open\s+page|where\s+can\s+i\s+find|go\s+to|(?:portal\s+)?navigation(?:\s+link)?(?:\s+for)?|(?:portal\s+)?link\s+(?:to|for))\b[\s\S]*\b(?:profile|personal\s+info(?:rmation)?|banking|documents?|pending\s+contract|contract(?:\s+details?)?|beneficiar(?:y|ies))\b/i;

/** Identifies requests that must use the portal-navigation capability. */
export const isPortalNavigationRequest = (query: string): boolean =>
  PORTAL_DESTINATION_PATTERN.test(query);

/** Builds validated portal links from the central portal route catalog. */
export class PortalNavigationService {
  /** Resolves a named page without exposing an incomplete or invalid URL. */
  public getLink(
    page: string,
    params: Readonly<Record<string, string>> = {},
  ): PortalNavigationResult {
    const normalizedPage = page.trim();
    console.log('normalizedPage', normalizedPage)
    const route = portalRoutes[normalizedPage];
    if (!route) return { unsupportedPage: normalizedPage };

    const missingParameter = this.getMissingParameter(route, params);
    if (missingParameter) return { missingParameter };

    return {
      title: route.title,
      url: route.urlTemplate.replace(PLACEHOLDER_PATTERN, (_, parameter: string) =>
        encodeURIComponent(params[parameter].trim()),
      ),
    };
  }

  private getMissingParameter(
    route: PortalRoute,
    params: Readonly<Record<string, string>>,
  ): string | undefined {
    for (const match of route.urlTemplate.matchAll(PLACEHOLDER_PATTERN)) {
      const parameter = match[1];
      if (!params[parameter]?.trim()) return parameter;
    }
    return undefined;
  }
}
