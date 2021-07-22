import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Geometry } from '@turf/helpers';
import { createFromTemplate } from 'ol/tileurlfunction.js';
import { BehaviorSubject, Observable, Observer } from 'rxjs';
import { retry } from 'rxjs/operators';
import { GeoNetworkService } from '../../network';
import { TileDBService } from '../../storage';
import { Tile } from '../Tile.interface';
import { ChildTileGeneration } from './tile-generation-strategies/child-tile-generation';
import { MiddleTileGeneration } from './tile-generation-strategies/middle-tile-generation';
import { ParentTileGeneration } from './tile-generation-strategies/parent-tile-generation';
import { TileGenerationParams } from './tile-generation-strategies/tile-generation-params.interface';
import { TileGenerationStrategy } from './tile-generation-strategies/tile-generation-strategy';
import { TileGenerationStrategies } from './tile-generation-strategies/tile-generation-strategy.interface';

function zoom(tile: Tile): Tile[] {
  const x0 = 2 * tile.X;
  const y0 = 2 * tile.Y;
  const z = tile.Z + 1;
  const tiles: Tile[] = [];
  for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
          tiles.push({X: x0 + i, Y: y0 + j, Z: z} as Tile);
      }
  }
  return tiles;
}

function getTreeNodes(root: Tile, maxDepth: number) {
  if (root.Z === maxDepth) {
    return [root];
  }

  const children = zoom(root);
  let nextChildren: Tile[] = [];
  children.forEach((child) => {
    nextChildren = nextChildren.concat(getTreeNodes(child, maxDepth));
  });
  return [root].concat(nextChildren);
}

function getNumberOfTreeNodes(deltaHeigth: number) {
  return (Math.pow(4, deltaHeigth + 1) - 1) / 3;
}

@Injectable({
  providedIn: 'root'
})
export class TileDownloaderService {
  readonly maxHeigthDelta: number = 4;
  readonly simultaneousRequests: number = 20;
  readonly averageBytesPerTile = 13375;

  readonly progression$: BehaviorSubject<number> = new BehaviorSubject(undefined);
  readonly isDownloading$: BehaviorSubject<boolean> = new BehaviorSubject(false);

  private tileGenerationStrategy: TileGenerationStrategy = new ParentTileGeneration();

  private urlQueue: string[] = [];
  private _isDownloading: boolean = false;
  private _nWorkerDone: number;

  private currentDownloads: number = 0;
  private downloadCount: number = 0;
  public validDownloadCount: number = 0;

  public urlGenerator: (coord: [number, number, number],
                        pixelRatio, projection) => string;

  constructor(
    private http: HttpClient,
    private network: GeoNetworkService,
    private geoDB: TileDBService,
  ) { }

  private initURLGenerator(tileGrid, url) {
    this.urlGenerator = createFromTemplate(url, tileGrid);
  }

  private generateURL(tile: Tile) {
    try {
      return this.urlGenerator([tile.Z, tile.X, tile.Y], 0, 0);
    } catch (e) {
      return undefined;
    }
  }

  public downloadFromCoord(
    coord3D: [number, number, number],
    regionID: number,
    generationParams: TileGenerationParams,
    tileGrid,
    src
  ) {
    if (!this.network.isOnline()) {
      return;
    }

    this.initURLGenerator(tileGrid, src);
    const rootTile: Tile = { X: coord3D[1], Y: coord3D[2], Z: coord3D[0] };

    const generationStrategy = generationParams.genMethod;
    this.changeStrategy(generationStrategy);

    const startLevel = generationParams.startLevel;
    const endLevel = generationParams.endLevel;
    const tiles = this.tileGenerationStrategy.generate(rootTile, startLevel, endLevel);

    this.addTilesToDownloadQueue(tiles, regionID);
  }

  downloadFromFeatures(
    geometries: Geometry[],
    regionID: number,
    generationParams: TileGenerationParams,
    tileGrid,
    templateUrl: string
  ) {
    if (!this.network.isOnline()) {
      return;
    }
    this.initURLGenerator(tileGrid, templateUrl);
    
    const generationStrategy = generationParams.genMethod;
    this.changeStrategy(generationStrategy);

    const startLevel = generationParams.startLevel;
    const endLevel = generationParams.endLevel;

    const tiles: Tile[] = this.tileGenerationStrategy
      .generateFromGeometries(geometries, startLevel, endLevel, tileGrid);

    this.addTilesToDownloadQueue(tiles, regionID);
  }

  private addTilesToDownloadQueue(tiles: Tile[], regionID: number) {
    tiles.forEach((tile) => {
      const url = this.generateURL(tile);
      if (url) {
        this.urlQueue.push(url);
      }
    });

    if (!this.isDownloading) {
      this.startDownload(regionID, tiles.length);
    } else {
      this.currentDownloads += tiles.length;
    }
  }

  public downloadFromUrls(urls: string[], regionID: number) {
    if (!this.network.isOnline()) {
      return;
    }

    urls.forEach((url) => {
      if (url) {
        this.urlQueue.push(url);
      }
    });

    if (!this.isDownloading) {
      this.startDownload(regionID, urls.length);
    } else {
      this.currentDownloads += urls.length;
    }
  }

  private startDownload(regionID: number, nDownloads: number) {
    this.downloadCount = 0;
    this.validDownloadCount = 0;
    this._nWorkerDone = 0;
    this.currentDownloads = nDownloads;
    console.log('starting download sequence!');
    this._isDownloading = true;
    this.isDownloading$.next(true);
    this.downloadSequence(regionID);
  }

  private downloadSequence(regionID: number) {
    const downloadTile = (url: string) => {
      return (observer: Observer<any>) => {
        const request = this.http.get(url, { responseType: 'blob' }).pipe(
          retry(2)
        );

        request.subscribe((blob) => {
          this.geoDB.update(url, regionID, blob).subscribe(() => {
            this.validDownloadCount++;
            observer.next('done downloading ' + url);
            observer.complete();
          });
        },
        (err) => {
          observer.next('done downloading ' + url);
          observer.complete();
        });
      };
    };

    const nWorkers = Math.min(this.simultaneousRequests, this.urlQueue.length);
    const nextDownload = () => {
      const url =  this.urlQueue.shift();
      if (!url) {
        this._nWorkerDone++;
        if (this._nWorkerDone === nWorkers) {
          this._isDownloading = false;
          this.isDownloading$.next(false);
        }
        console.log('downloading is done');
        return;
      }
      this.progression$.next(++this.downloadCount);
      const request = new Observable(downloadTile(url));
      request.subscribe(() => nextDownload());
    };

    for (let i = 0; i < nWorkers; i++) {
      nextDownload();
    }
  }

  public changeStrategy(strategyName: string) {
    switch (strategyName) {
      case TileGenerationStrategies.PARENT:
        this.tileGenerationStrategy = new ParentTileGeneration();
        break;
      case TileGenerationStrategies.MIDDLE:
        this.tileGenerationStrategy = new MiddleTileGeneration();
        break;
      case TileGenerationStrategies.CHILD:
        this.tileGenerationStrategy = new ChildTileGeneration();
        break;
      default:
        throw new Error('Invalid Tile Generation Strategy');
    }
  }

  public getBufferProgression() {
    return 1 - this.urlQueue.length / this.currentDownloads;
  }
  // need to remove from here
  public downloadEstimate(nTiles: number) {
    return nTiles * this.averageBytesPerTile;
  }

  // need to remove from here
  public downloadEstimatePerDepth(depth: number) {
    const nTiles = getNumberOfTreeNodes(depth);
    return this.downloadEstimate(nTiles);
  }

  // need to remove from here
  public numberOfTiles(depth: number) {
    return getNumberOfTreeNodes(depth);
  }

  get isDownloading() {
    return this._isDownloading;
  }

  get strategy(): TileGenerationStrategies {
    const strategyName = this.tileGenerationStrategy.constructor.name;
    switch (strategyName) {
      case ChildTileGeneration.name:
        return TileGenerationStrategies.CHILD;
      case MiddleTileGeneration.name:
        return TileGenerationStrategies.MIDDLE;
      case ParentTileGeneration.name:
        return TileGenerationStrategies.PARENT;
      default:
        return;
    }
  }
}
