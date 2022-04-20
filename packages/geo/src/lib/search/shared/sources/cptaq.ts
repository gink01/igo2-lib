import { Injectable, Inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';

import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';

import olWKT from 'ol/format/WKT';

import { FEATURE, Feature, FeatureGeometry } from '../../../feature';

import { SearchResult } from '../search.interfaces';
import { SearchSource, TextSearch } from './source';
import { SearchSourceOptions, TextSearchOptions } from './source.interfaces';

import { LanguageService, StorageService } from '@igo2/core';
import { computeTermSimilarity } from '../search.utils';
import { Cacheable } from 'ts-cacheable';

import { GoogleLinks } from './../../../utils/googleLinks';

/**
 * CPTAQ search source
 */
@Injectable()
export class CptaqSearchSource extends SearchSource implements TextSearch {
  static id = 'cptaq';
  static type = FEATURE;

  constructor(
    private http: HttpClient,
    private languageService: LanguageService,
    storageService: StorageService,
    @Inject('options') options: SearchSourceOptions
  ) {
    super(options, storageService);
  }

  getId(): string {
    return CptaqSearchSource.id;
  }

  getType(): string {
    return CptaqSearchSource.type;
  }

  /*
   * Source : https://wiki.openstreetmap.org/wiki/Key:amenity
   */
  protected getDefaultOptions(): SearchSourceOptions {
    return {
      title: 'Dossiers',
     // searchUrl: 'https://carto.cptaq.gouv.qc.ca/php/RechercheDossier.php?'
      searchUrl: 'https://carto-dev.cptaq.local/php/RechercheDossier.php?'
    };
  }

  /**
   * Search by file number
   * @param term File numbere
   * @returns Observable of <SearchResult<Feature>[]
   */
  @Cacheable({
    maxCacheCount: 20
  })
  search(
    term: string | undefined,
    options?: TextSearchOptions
  ): Observable<SearchResult<Feature>[]> {
    term = term.endsWith(',') ? term.slice(0, -1) : term;
    term = term.startsWith(',') ? term.substr(1) : term;
    term = term.replace(/ /g, '');

    const params = this.computeSearchRequestParams(term, options || {});
    if (!params.get('numero') || !params.get('numero').match(/^[0-9,]+$/g)) {
      return of([]);
    }
    return this.http
      .get(this.searchUrl, { params, responseType: 'text' })
      .pipe(map((response: string) => this.extractResults(response, term)));
  }

  private computeSearchRequestParams(
    term: string,
    options: TextSearchOptions
  ): HttpParams {
    return new HttpParams({
      fromObject: Object.assign(
        {
          numero: term,
          epsg: '4326'
        },
        this.params,
        options.params || {}
      )
    });
  }

  private extractResults(response: string, term: string): SearchResult<Feature>[] {
    return response
      .split('ZZZ')
      .filter((dossier: string) => dossier.length > 0)
      .map((dossier: string) => this.dataToResult(dossier, term));
  }

  private dataToResult(data: string, term: string): SearchResult<Feature> {
    const dossier = data.split(';');
    const numero = dossier[0];
    const wkt = dossier[9];
    const geometry:FeatureGeometry = this.computeGeometry(wkt);
    const resultat = dossier[8];
    const lienpdf = dossier[10];
    const gid = dossier[11];
    const pt:FeatureGeometry = {
      type: 'Point',
      coordinates: [dossier[5], dossier[6]]
    };

    const properties = {
      Dossier: numero + ' ' + lienpdf,
      Décision: resultat,
      GoogleMaps: GoogleLinks.getGoogleMapsCoordLink(pt.coordinates[0], pt.coordinates[1]),
    //  GoogleStreetView: GoogleLinks.getGoogleStreetViewLink(pt.coordinates[0], pt.coordinates[1]),
      Routes: '<span class="routing"> <u>' + this.languageService.translate.instant('igo.geo.seeRouting') + '</u> </span>'
    };
    const id = [this.getId(), 'cptaq', numero, gid].join('.');

    return {
      source: this,
      meta: {
        dataType: FEATURE,
        id,
        title: numero,
        score: computeTermSimilarity(term.trim(), numero),
        icon: 'map-marker'
      },
      data: {
        type: FEATURE,
        projection: 'EPSG:4326',
        geometry,
        properties,
        meta: {
          id,
          title: numero
        }
      }
    };
  }

  private computeGeometry(wkt: string): FeatureGeometry {
    const feature = new olWKT().readFeature(wkt, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:4326'
    });
    return {
      type: feature.getGeometry().getType(),
      coordinates: feature.getGeometry().getCoordinates()
    };
  }
}
