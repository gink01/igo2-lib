import { HttpClient } from '@angular/common/http';

import { ConfigService, LanguageService, StorageService } from '@igo2/core';

import { SearchSource } from './source';
import { CptaqSearchSource } from './cptaq';

/**
 * CPTAQ search source factory
 * @ignore
 */
export function cptaqSearchSourceFactory(
  http: HttpClient,
  languageService: LanguageService,
  storageService: StorageService,
  config: ConfigService
) {
  return new CptaqSearchSource(
    http,
    languageService,
    storageService,
    config.getConfig(`searchSources.${CptaqSearchSource.id}`),
  );
}

/**
 * Function that returns a provider for the Cadastre search source
 */
export function provideCptaqSearchSource() {
  return {
    provide: SearchSource,
    useFactory: cptaqSearchSourceFactory,
    multi: true,
    deps: [HttpClient, LanguageService, StorageService, ConfigService]
  };
}
