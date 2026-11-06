/** Registro de pestañas del editor: orden, nombre visible y constructor del panel. */
import type { EditorTab } from '../../core/types';
import type { Child } from '../controls';
import type { EditorContext } from '../context';
import { buildAgujeroTab } from './agujero';
import { buildCancionesTab } from './canciones';
import { buildCarpetaTab } from './carpeta';
import { buildDiscoTab } from './disco';
import { buildFundaExteriorTab } from './funda-exterior';
import { buildFundaInteriorTab } from './funda-interior';
import { buildGalletaTab } from './galleta';
import { buildLomoTab } from './lomo';
import { buildSurcosTab } from './surcos';

export interface TabDefinition {
  id: EditorTab;
  label: string;
  build(ctx: EditorContext): Child[];
}

export const TABS: readonly TabDefinition[] = [
  { id: 'disco', label: 'Disco', build: buildDiscoTab },
  { id: 'surcos', label: 'Surcos', build: buildSurcosTab },
  { id: 'agujero', label: 'Agujero', build: buildAgujeroTab },
  { id: 'galleta', label: 'Galleta', build: buildGalletaTab },
  { id: 'funda-interior', label: 'Funda interior', build: buildFundaInteriorTab },
  { id: 'carpeta', label: 'Carpeta', build: buildCarpetaTab },
  { id: 'lomo', label: 'Lomo', build: buildLomoTab },
  { id: 'funda-exterior', label: 'Funda exterior', build: buildFundaExteriorTab },
  { id: 'canciones', label: 'Canciones', build: buildCancionesTab },
];

export function tabDefinition(id: EditorTab): TabDefinition {
  return TABS.find((t) => t.id === id) ?? (TABS[0] as TabDefinition);
}
