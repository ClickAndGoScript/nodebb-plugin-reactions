<div class="mb-3">
	<h4>{{tx("reactions:users-who-reacted")}} <small>({total})</small></h4>
	{{{ each users }}}
	<a class="text-decoration-none" href="{config.relative_path}/user/{./userslug}">{{buildAvatar(@value, "24px", true)}}</a>
	{{{ end }}}
</div>
