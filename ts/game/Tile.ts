import { SURFACE_TILES, TILE } from "../Constants";
import Canvas from "../ui/Canvas";
import { IMouseEventHandler } from "../ui/Mouse";
import Sprite from "../ui/Sprite";
import Direction, { Directions } from "../util/Direction";
import Random from "../util/Random";
import Sound, { SoundType } from "../util/Sound";
import World from "./World";

enum DamageType {
	None,
	Mining,
	Explosion,
	Invulnerable = Infinity,
}

export enum TileType {
	Rock,
	Metal,
	Grass,
	Emerald,
	Cavern,
	Mineshaft,
	Explosives,
	Gold,
}

export enum TileCategory {
	Ore,
}

const LIGHT_MAX = 3;

type TileDescriptionMouseHandler = {
	[E in keyof IMouseEventHandler]: (tile: Tile, ...params: Parameters<Exclude<IMouseEventHandler[E], undefined>>) => ReturnType<Exclude<IMouseEventHandler[E], undefined>>;
};

interface ITileDescription extends TileDescriptionMouseHandler {
	hitSound?: SoundType;
	breakSound?: SoundType;
	breakable?: DamageType;
	nonselectable?: true;
	mask?: string;
	base?: TileType;
	category?: TileCategory;
	invisible?: true;
	background?: TileType;
	light?: number;
	score?: number;
	separated?: true;
	update?(tile: Tile): false | void;
	damage?(tile: Tile, damageType: DamageType, amount: number): false | void;
}

const tiles: Record<TileType, ITileDescription> = {
	[TileType.Metal]: {
		hitSound: SoundType.Metal,
		breakable: DamageType.Explosion,
	},
	[TileType.Rock]: {
		hitSound: SoundType.Hit,
		mask: "rock",
		background: TileType.Rock,
		breakable: DamageType.Mining,
	},
	[TileType.Grass]: {
		mask: "rock",
		breakable: DamageType.Mining,
	},
	[TileType.Emerald]: {
		base: TileType.Rock,
		category: TileCategory.Ore,
		hitSound: SoundType.Gem,
		breakSound: SoundType.BreakGem,
		score: 100,
	},
	[TileType.Gold]: {
		base: TileType.Rock,
		category: TileCategory.Ore,
		hitSound: SoundType.Gem,
		breakSound: SoundType.BreakGem,
		score: 100,
	},
	[TileType.Mineshaft]: {
		invisible: true,
		nonselectable: true,
		background: TileType.Rock,
		light: LIGHT_MAX + 1,
		onMouseRightClick (tile: Tile) {
			if (tile.context.world.stats.explosives <= 0)
				return;

			tile.context.world.stats.explosives--;
			tile.context.world.setTile(tile.context.x, tile.context.y, TileType.Explosives);
		},
	},
	[TileType.Cavern]: {
		invisible: true,
		nonselectable: true,
		background: TileType.Rock,
		update (tile: Tile) {
			if (tile.getLight() === LIGHT_MAX)
				tile.remove(true);
		},
	},
	[TileType.Explosives]: {
		background: TileType.Rock,
		separated: true,
		onMouseClick (tile: Tile) {
			if (!tile.isAccessible())
				return;

			tile.context.world.stats.addExplosive();
			tile.remove(true);
		},
		onMouseRightClick (tile: Tile) {
			if (!tile.isAccessible())
				return;

			explodeExplosives(tile);
		},
		damage (tile: Tile, damageType: DamageType) {
			if (damageType === DamageType.Explosion)
				explodeExplosives(tile);
		},
	},
};

function explodeExplosives (tile: Tile) {
	tile.remove(true);
	Sound.get(SoundType.Explode).play();

	const range = Random.int(4, Random.int(5, Random.int(6, 8))); // use multiple calls to weight smaller explosions higher
	for (let y = -range + 1; y < range; y++) {
		const absY = Math.abs(y);
		for (let x = -range + 1; x < range; x++) {
			const damage = Math.max(0, range - (Math.abs(x) + absY));
			if (damage)
				tile.context.world.getTile(tile.context.x + x, tile.context.y + y)
					?.damage(DamageType.Explosion, damage * 2, false);
		}
	}
}

function getProperty<P extends keyof ITileDescription> (type: TileType, property: P): ITileDescription[P];
function getProperty<P extends keyof ITileDescription> (type: TileType, property: P, orElse?: Exclude<ITileDescription[P], undefined>): Exclude<ITileDescription[P], undefined>;
function getProperty<P extends keyof ITileDescription> (type: TileType, property: P, orElse?: Exclude<ITileDescription[P], undefined>): ITileDescription[P] {
	let description = tiles[type];
	if (description[property] === undefined && description.base !== undefined)
		return getProperty(description.base, property);

	return description[property] ?? orElse;
}

export interface ITileContext {
	world: World;
	x: number;
	y: number;
}

export default class Tile implements IMouseEventHandler {

	private hovering = false;
	public context: ITileContext;

	private durability = Random.int(2, 4);
	private breakAnim = 0;

	private mask?: Direction;
	private light?: number;
	private recalcLightTick: number | undefined = -1;

	public constructor (public readonly type: TileType, world: World, x: number, y: number) {
		this.context = { world, x, y };
	}

	public get description () {
		return tiles[this.type];
	}

	public remove (accessible: boolean) {
		this.context.world.removeTile(this.context.x, this.context.y, accessible);
		return this;
	}

	public invalidate () {
		delete this.mask;
		this.recalcLightTick = this.context.world.stats.tick;
	}

	public getMask () {
		if (this.mask === undefined)
			this.updateMask();

		return this.mask;
	}

	private updateMask () {
		this.mask = Direction.None;
		if (!getProperty(this.type, "mask"))
			return;

		for (const direction of Directions.CARDINALS) {
			const tile = this.context.world.getTileInDirection(direction, this.context);
			if (!tile || tile.description.invisible || tile.description.separated)
				this.mask |= direction;
		}
	}

	public getLight () {
		let producedLight = getProperty(this.type, "light");
		if (producedLight)
			return producedLight;

		if (this.recalcLightTick !== undefined && this.recalcLightTick < this.context.world.stats.tick)
			this.updateLight();

		return this.light ?? 0;
	}

	private updateLight () {
		const tiles = Directions.CARDINALS
			.map(direction => this.context.world.getTileInDirection(direction, this.context));

		const maxLightLevel = Math.max(...tiles.map(tile => tile ? getProperty(tile?.type, "light") ?? tile?.light ?? 0 : 0));
		this.light = maxLightLevel - 1;
		for (const tile of tiles)
			if (tile && (tile.light ?? 0) < this.light - 1)
				tile.invalidate();

		delete this.recalcLightTick;
	}

	public static getSprite (type: TileType) {
		const description = tiles[type];
		const category = description.category === undefined ? "" : `/${TileCategory[description.category]}`;
		return Sprite.get(`tile${category}/${TileType[type].toLowerCase()}`);
	}

	public static render (type: TileType, canvas: Canvas, x: number, y: number, light?: number, mask?: Direction, tile?: Tile) {
		const description = tiles[type];

		if (description.invisible && description.background === undefined || light === 0)
			return;

		if (light !== undefined && light < LIGHT_MAX)
			canvas.context.filter = `brightness(${Math.floor(light / LIGHT_MAX * 100)}%)`;

		if (!description.invisible) {
			if (description.base !== undefined)
				Tile.render(description.base, canvas, x, y, undefined, mask, tile);

			Tile.getSprite(type).render(canvas, x, y);

			if (mask && description.mask) {
				const maskSprite = Sprite.get(`tile/mask/${description.mask}`);
				canvas.context.globalCompositeOperation = "destination-out";

				if (mask & Direction.North)
					maskSprite.render(canvas, x, y, 0, 0, TILE, TILE);
				if (mask & Direction.East)
					maskSprite.render(canvas, x, y, TILE, 0, TILE, TILE);
				if (mask & Direction.South)
					maskSprite.render(canvas, x, y, TILE, TILE, TILE, TILE);
				if (mask & Direction.West)
					maskSprite.render(canvas, x, y, 0, TILE, TILE, TILE);
			}
		}

		canvas.context.globalCompositeOperation = "destination-over";
		if (description.background !== undefined && (tile?.context.y ?? 0) >= SURFACE_TILES)
			Sprite.get(`tile/background/${TileType[description.background].toLowerCase()}`).render(canvas, x, y);

		if (light !== undefined)
			canvas.context.filter = "none";

		canvas.context.globalCompositeOperation = "source-over";
	}

	public render (canvas: Canvas, x: number, y: number) {
		Tile.render(this.type, canvas, x, y, this.getLight(), this.getMask(), this);

		if (this.breakAnim)
			Sprite.get(`tile/break/${this.breakAnim}`).render(canvas, x, y);

		if (this.hovering && this.isAccessible())
			Sprite.get("ui/hover").render(canvas, x, y);
	}

	public update () {
		tiles[this.type].update?.(this);
	}

	public isAccessible () {
		return this.light === LIGHT_MAX && !tiles[this.type].nonselectable;
	}

	public isMineable () {
		return this.isAccessible() && DamageType.Mining >= getProperty(this.type, "breakable", DamageType.Invulnerable);
	}

	public onMouseEnter () {
		this.hovering = true;
		this.handleEvent("onMouseEnter");
	}

	public onMouseLeave () {
		this.hovering = false;
		this.handleEvent("onMouseLeave");
	}

	public onMouseClick (x: number, y: number) {
		this.handleEvent("onMouseClick", x, y);
	}

	public onMouseRightClick (x: number, y: number) {
		this.handleEvent("onMouseRightClick", x, y);
	}

	public onMouseDown (x: number, y: number) {
		this.handleEvent("onMouseDown", x, y);
	}

	public onMouseUp (x: number, y: number) {
		this.handleEvent("onMouseUp", x, y);
	}

	public damage (damageType: DamageType, amount = 1, effects = true) {
		getProperty(this.type, "damage")?.(this, damageType, amount);

		if (damageType >= getProperty(this.type, "breakable", DamageType.Invulnerable)) {
			this.durability -= amount;
			if (this.durability < 0) {
				this.break(damageType, effects);
				return;
			}

			this.breakAnim++;
		}

		if (effects) {
			Sound.get(getProperty(this.type, "hitSound"))?.play();
			this.particles(2);
		}
	}

	public break (damageType: DamageType, effects = true) {
		this.context.world.removeTile(this.context.x, this.context.y, true);

		this.context.world.stats.score += tiles[this.type].score ?? 0;
		if (damageType === DamageType.Mining)
			this.context.world.stats.dig();

		if (effects) {
			Sound.get(getProperty(this.type, "breakSound") ?? SoundType.Break).play();
			this.particles(16);
		}
	}

	public particles (amount: number) {
		this.context.world.particles.create(Tile.getSprite(this.type),
			this.context.x * TILE + TILE / 2,
			this.context.y * TILE + TILE / 2,
			amount);
	}

	public onMouseHold (x: number, y: number) {
		if (this.handleEvent("onMouseHold", x, y) === false)
			return;

		if (!this.hovering || !this.isAccessible())
			return;

		if (this.context.world.stats.exhaustion)
			return;

		this.context.world.stats.exhaustion = 10;
		this.damage(DamageType.Mining);
	}

	private handleEvent (event: keyof IMouseEventHandler, x?: number, y?: number) {
		return tiles[this.type][event]?.(this, x!, y!);
	}
}
