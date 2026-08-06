import { portalNavigationRoutes } from "@app/config/portal-navigation.config";

export interface PortalNavigationLink {
  readonly title: string;
  readonly url: string;
}

export interface MissingPortalNavigationParameter {
  readonly missingParameter: string;
}

export type PortalNavigationResult =
  PortalNavigationLink | MissingPortalNavigationParameter;

/** Resolves configured portal routes without embedding page-specific logic. */
export class PortalNavigationService {
  public getLink(
    page: string,
    params: Readonly<Record<string, string>> = {},
  ): PortalNavigationResult {
    const route = portalNavigationRoutes[page];
    if (!route) throw new Error(`Unsupported portal page: ${page}.`);

    const missingParameter = route.requiredParams?.find(
      (parameter) => !params[parameter]?.trim(),
    );
    if (missingParameter) return { missingParameter };

    return {
      title: route.title,
      url: route.urlTemplate.replace(/\{([^}]+)\}/g, (_, parameter: string) =>
        encodeURIComponent(params[parameter]),
      ),
    };
  }
}
