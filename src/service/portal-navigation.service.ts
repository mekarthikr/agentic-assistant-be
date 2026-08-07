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
    const normalizedPage = this.normalizePageName(page);
    const route = portalRoutes[normalizedPage];
    if (!route) return { unsupportedPage: page };

    const missingParameter = this.getMissingParameter(route, params);
    if (missingParameter) return { missingParameter };

    return {
      title: route.title,
      url: route.urlTemplate.replace(PLACEHOLDER_PATTERN, (_, parameter: string) =>
        encodeURIComponent(params[parameter].trim()),
      ),
    };
  }

  private normalizePageName(page: string): string {
    // Remove common suffixes and normalize spacing
    let normalized = page
      .trim()
      .toLowerCase()
      .replace(/\s+(page|tab|section)\s*$/, '')
      .replace(/\s+/g, ' ');

    // Map common variations to exact keys in portalRoutes
    const pageMap: Record<string, string> = {
      'personal info': 'personalInfo',
      'personal information': 'personalInfo',
      'contract details': 'contractDetails',
      'contract detail': 'contractDetails',
      'pending contract': 'pendingContractDetails',
      'pending contract details': 'pendingContractDetails',
      'profile': 'profile',
      'banking': 'banking',
      'documents': 'documents',
      'document': 'documents',
      'beneficiaries': 'beneficiaries',
      'beneficiary': 'beneficiaries',
    };

    return pageMap[normalized] || normalized;
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
