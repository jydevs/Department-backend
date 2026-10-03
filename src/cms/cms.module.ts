import { Module } from "@nestjs/common";
import { ContentModule } from "./content/content.module";
import { MediaModule } from "./media/media.module";
import { RedirectsModule } from "./redirects/redirects.module";
import { ContentSeedService } from "./seed/content-seed.service";

/** Online-Store-2.0-style CMS: versioned documents (settings, menus, templates, pages), media library and redirects. */
@Module({
  imports: [ContentModule, MediaModule, RedirectsModule],
  providers: [ContentSeedService],
})
export class CmsModule {}
