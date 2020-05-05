import { Component, ChangeDetectionStrategy } from '@angular/core';

import {
  IgoMap
} from '@igo2/geo';
import { ToolComponent } from '@igo2/common';
import { MapState } from '../../map/map.state';

@ToolComponent({
  name: 'spatialFilterExportTool',
  title: 'igo.integration.tools.spatialFilterExport',
  icon: 'selection-marker',
  parent: 'spatialFilter'
})

@Component({
  selector: 'igo-spatial-filter-export-tool',
  templateUrl: './spatial-filter-export-tool.component.html',
  styleUrls: ['./spatial-filter-export-tool.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SpatialFilterExportToolComponent {
  get map(): IgoMap {
    return this.mapState.map;
  }

  constructor(
    private mapState: MapState
  ) {}

}
