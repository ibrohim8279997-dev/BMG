/** Product photographs cropped from the BMG design templates, keyed by category slug. */
const IMG: Record<string, string> = {
  cement: '/img/cement.jpg', gasblock: '/img/gasblock.jpg', brick: '/img/brick.jpg', plaster: '/img/plaster.jpg',
  tile: '/img/tile.jpg', roofing: '/img/roofing.jpg', rebar: '/img/rebar.jpg', paver: '/img/paver.jpg',
};
export const catImg = (slug?: string | null) => (slug && IMG[slug]) || null;
