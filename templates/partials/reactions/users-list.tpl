<div class="reactions-users-modal">
	<div class="d-flex align-items-center gap-2 mb-2">
		{{emojiHtml}}
		<span class="text-muted">{total}</span>
	</div>
	<ul class="list-unstyled mb-0 reactions-users-list">
		{{{ each users }}}
		<li class="py-1">
			<a class="d-flex align-items-center gap-2 text-decoration-none" href="{config.relative_path}/user/{./userslug}">
				{{buildAvatar(users, "28px", true)}}
				<span class="fw-semibold">{./username}</span>
			</a>
		</li>
		{{{ end }}}
	</ul>
</div>
