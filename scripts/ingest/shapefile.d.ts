declare module 'shapefile' {
  interface Source {
    read(): Promise<{ done: true } | { done: false; value: GeoJSONFeature }>;
    close?(): Promise<void>;
  }

  interface GeoJSONFeature {
    type: 'Feature';
    geometry: { type: string; coordinates: unknown } | null;
    properties: Record<string, unknown> | null;
  }

  export function open(shp: string, dbf?: string): Promise<Source>;
}
