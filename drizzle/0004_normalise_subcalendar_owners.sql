-- Older owner moves patched only the top-level row, so a sub-calendar could stay
-- shared (owner_id NULL) under a person-owned parent. An ownerless parent could
-- likewise keep an owned child. Visibility and permissions fold the root's owner,
-- and this backfill restores the invariant in stored rows.
UPDATE `calendar`
SET
	`owner_id` = (
		SELECT `root`.`owner_id`
		FROM `calendar` `root`
		WHERE `root`.`id` = `calendar`.`parent_id`
	)
WHERE
	`parent_id` IS NOT NULL;
