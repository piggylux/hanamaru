<script lang="ts" module>
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import Book from '@lucide/svelte/icons/book';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import Check from '@lucide/svelte/icons/check';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Columns2 from '@lucide/svelte/icons/columns-2';
  import Download from '@lucide/svelte/icons/download';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Folder from '@lucide/svelte/icons/folder';
  import GalleryVertical from '@lucide/svelte/icons/gallery-vertical';
  import Heart from '@lucide/svelte/icons/heart';
  import Layers from '@lucide/svelte/icons/layers';
  import LibraryBig from '@lucide/svelte/icons/library-big';
  import Maximize from '@lucide/svelte/icons/maximize';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Moon from '@lucide/svelte/icons/moon';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import RectangleVertical from '@lucide/svelte/icons/rectangle-vertical';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import ScanSearch from '@lucide/svelte/icons/scan-search';
  import Search from '@lucide/svelte/icons/search';
  import Settings from '@lucide/svelte/icons/settings';
  import Shuffle from '@lucide/svelte/icons/shuffle';
  import Star from '@lucide/svelte/icons/star';
  import Sun from '@lucide/svelte/icons/sun';
  import Tag from '@lucide/svelte/icons/tag';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Upload from '@lucide/svelte/icons/upload';
  import X from '@lucide/svelte/icons/x';

  /** Lucide icons, under the names the app uses for them */
  const ICONS = {
    search: Search,
    heart: Heart,
    star: Star,
    library: LibraryBig,
    tag: Tag,
    folder: Folder,
    collection: Layers,
    settings: Settings,
    sun: Sun,
    moon: Moon,
    monitor: Monitor,
    close: X,
    back: ChevronLeft,
    forward: ChevronRight,
    book: BookOpen,
    unread: Book,
    edit: Pencil,
    external: ExternalLink,
    refresh: RotateCcw,
    fullscreen: Maximize,
    plus: Plus,
    download: Download,
    upload: Upload,
    trash: Trash2,
    check: Check,
    match: ScanSearch,
    alert: TriangleAlert,
    random: Shuffle,
    single: RectangleVertical,
    double: Columns2,
    strip: GalleryVertical,
    direction: ArrowLeftRight,
  };

  export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
  let {
    name,
    size = 18,
    filled = false,
    label,
  }: { name: IconName; size?: number; filled?: boolean; label?: string } = $props();

  const Component = $derived(ICONS[name]);
</script>

<Component
  {size}
  strokeWidth={1.75}
  fill={filled ? 'currentColor' : 'none'}
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  class="icon"
/>

<style>
  :global(svg.icon) {
    flex: none;
  }
</style>
