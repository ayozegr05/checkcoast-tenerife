import { beachStateKey, BEACH_STATE_LABEL_LONG } from './structural';

// Estado de playa para el selector de puntos de muestreo y el acento
// de la cabecera de la ficha — delega en el resolutor único de
// lib/structural (la misma matriz que statusOf en la lista):
// 'structural' devuelve granate en la ficha (asa, borde, banda) en
// vez del rojo de contaminación, y una apta con alerta viva baja a
// 'warning' para no decir "Sin alertas" donde la ficha dice "Aviso"
export const beachStatusKey = beachStateKey;

export const BEACH_STATUS_TEXT = BEACH_STATE_LABEL_LONG;
