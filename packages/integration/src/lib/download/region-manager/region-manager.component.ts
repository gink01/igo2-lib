import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { DownloadRegionService, Region, RegionDBData, RegionDBService, RegionStatus } from '@igo2/core';
import { Feature } from '@igo2/geo';
import { MatCarouselComponent } from '@ngbmodule/material-carousel';
import { BehaviorSubject } from 'rxjs';
import { first } from 'rxjs/operators';
import { MapState } from '../../map';
import { DownloadState } from '../download.state';
import { RegionManagerState } from './region-manager.state';

export interface DisplayRegion extends Region {
  id: number;
  name: string;
  numberOfTiles: number;
  parentUrls: string[];
}

@Component({
  selector: 'igo-region-manager',
  templateUrl: './region-manager.component.html',
  styleUrls: ['./region-manager.component.scss']
})
export class RegionManagerComponent implements OnInit, OnDestroy {
  @ViewChild('regionCarousel') regionCarousel: MatCarouselComponent;

  regions: BehaviorSubject<Region[]> = new BehaviorSubject(undefined);
  displayedColumns = ['edit', 'delete', 'name', 'nTiles', 'space'];
  buttonClicked: boolean = false;

  constructor(
    private regionDB: RegionDBService,
    private downloadManager: DownloadRegionService,
    private downloadState: DownloadState,
    private state: RegionManagerState,
    private mapState: MapState
  ) {
    this.updateRegions();
    this.regionDB.update$.subscribe(() => {
        this.selectedRegion = undefined;
        this.updateRegions();
      }
    );
  }

  ngOnInit() {
  }

  ngOnDestroy() {
    this.clearFeatures();
  }

  private get regionStore() {
    return this.downloadState.regionStore;
  }

  private get map() {
    return this.mapState.map;
  }

  public updateRegions() {
    this.regionDB.getAll().pipe(first())
      .subscribe((RegionDBDatas: RegionDBData[]) => {
        const regions = this.createRegion(RegionDBDatas);
        this.regions.next(regions);
      });
  }

  private createRegion(RegionDBDatas: RegionDBData[]) {
    const regions: DisplayRegion[] = [];
    const nameOccurences: Map<string, number> = new Map();
    for (const region of RegionDBDatas) {
      const name = region.name;
      let occurence = nameOccurences.get(name);
      if (occurence === undefined) {
        regions.push(region);
        nameOccurences.set(name, 1);
      } else {
        const newName = name + ' (' + occurence + ')';
        region.name = newName;
        regions.push(region);
        nameOccurences.set(name, ++occurence);
      }
    }
    return regions;
  }

  public deleteRegion(region) {
    this.buttonClicked = true;
    this.downloadManager.deleteRegionByID(region.id);
    this.unselectRegion();
    this.clearFeatures();
  }

  public editRegion(region) {
    this.buttonClicked = true;
    const dbRequest = this.regionDB.getByID(region.id);
    dbRequest.subscribe((regionDBData: RegionDBData) => {
      this.regionToEdit$.next(regionDBData);
    });
  }

  public getRegion(row: DisplayRegion) {
    this.selectRegion(row);
    this.regionCarousel.slideTo(0);
    this.showSelectedRegionFeatures();
  }

  private selectRegion(region: DisplayRegion) {
    if (this.selectedRegion.id === region.id) {
      this.unselectRegion();
    } else {
      this.selectedRegion = region;
    }
  }

  private unselectRegion() {
    this.selectedRegion = undefined;
  }

  public getRegionSpaceInMB(region: DisplayRegion) {
    const space: number = this.downloadManager
      .getDownloadSpaceEstimate(region.numberOfTiles);
    return (space * 1e-06).toFixed(4);
  }

  public showSelectedRegionFeatures() {
    this.regionStore.clear();
    if (!this.selectedRegionFeatures) {
      return;
    }

    this.regionStore.updateMany(this.selectedRegionFeatures);
  }

  public clearFeatures() {
    this.regionStore.clear();
  }

  public rowClick(row: DisplayRegion) {
    if (this.buttonClicked) {
      this.buttonClicked = false;
      return;
    }
    this.getRegion(row);
  }

  public disableDeleteButton(region: DisplayRegion) {
    return region.status === RegionStatus.Downloading;
  }
  set selectedRegion(region: DisplayRegion) {
    this.state.selectedRegion = region;
  }

  get selectedRegion(): DisplayRegion {
    return this.state.selectedRegion;
  }

  get selectedRegionUrls(): string[] {
    return this.selectedRegion.parentUrls;
  }

  get selectedRegionFeatures(): Feature[] {
    return this.selectedRegion.parentFeatureText.map(
      (featureText: string) => {
        return JSON.parse(featureText);
      });
  }

  get selectedRowID(): number{
    return this.selectedRegion.id;
  }

  get regionToEdit$() {
    return this.state.regionToEdit$;
  }
}