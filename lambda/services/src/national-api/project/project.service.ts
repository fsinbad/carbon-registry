import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ProjectDto } from '../../shared/dto/project.dto';
import { Project } from '../../shared/entities/project.entity';
import { ProjectLedgerService } from '../../shared/project-ledger/project-ledger.service';
import { generateSerialNumber } from 'serial-number-gen';
import { instanceToPlain, plainToClass } from 'class-transformer';
import { ProjectStatus } from '../../shared/project-ledger/project-status.enum';
import { AgricultureConstants, AgricultureCreationRequest, calculateCredit, SolarConstants, SolarCreationRequest } from 'carbon-credit-calculator';
import { QueryDto } from '../../shared/dto/query.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrimaryGeneratedColumnType } from 'typeorm/driver/types/ColumnTypes';
import { CounterService } from '../../shared/util/counter.service';
import { CounterType } from '../../shared/util/counter.type.enum';
import { SubSector } from '../../shared/enum/subsector.enum';
import { ConstantEntity } from '../../shared/entities/constants.entity';
import { DataResponseDto } from '../../shared/dto/data.response.dto';
import { ConstantUpdateDto } from '../../shared/dto/constants.update.dto';
import { ProjectApprove } from '../../shared/dto/project.approve';
import { DataListResponseDto } from '../../shared/dto/data.list.response';

export declare function PrimaryGeneratedColumn(options: PrimaryGeneratedColumnType): Function;

@Injectable()
export class ProjectService {

    constructor(
        private projectLedger: ProjectLedgerService, 
        private counterService: CounterService,
        @InjectRepository(Project) private projectRepo: Repository<Project>, 
        @InjectRepository(ConstantEntity) private constantRepo: Repository<ConstantEntity>,
        private logger: Logger) {}

    private toProject(projectDto: ProjectDto): Project {
        const data = instanceToPlain(projectDto);
        this.logger.verbose('Converted project', JSON.stringify(data))
        return plainToClass(Project, data);
    }

    private async getCreditRequest(projectDto: ProjectDto, constants: ConstantEntity) {
        switch(projectDto.subSector) {
            case SubSector.AGRICULTURE:
                const ar = new AgricultureCreationRequest()
                ar.duration = (projectDto.endTime - projectDto.startTime)
                ar.durationUnit = "s"
                ar.landArea = projectDto.agricultureProperties.landArea;
                ar.landAreaUnit = projectDto.agricultureProperties.landAreaUnit
                if (constants) {
                    ar.agricultureConstants = constants.data as AgricultureConstants
                } 
                return ar;
            case SubSector.SOLAR:
                const sr = new SolarCreationRequest()
                sr.buildingType = projectDto.solarProperties.consumerGroup;
                sr.energyGeneration = projectDto.solarProperties.energyGeneration;
                sr.energyGenerationUnit = projectDto.solarProperties.energyGenerationUnit
                if (constants) {
                    sr.solarConstants = constants.data as SolarConstants
                } 
                return sr;
        }
        throw Error("Unknown sub sector " + projectDto.subSector)
    }

    async create(projectDto: ProjectDto): Promise<Project | undefined> {
        this.logger.verbose('ProjectDTO received', projectDto)
        const project: Project = this.toProject(projectDto);
        this.logger.verbose('Project create', project)
        project.projectId = (await this.counterService.incrementCount(CounterType.PROJECT, 4))
        const year = new Date(projectDto.startTime*1000).getFullYear()
        const startBlock = await this.counterService.getCount(CounterType.ITMO) + 1

        const constants = await this.getLatestConstant(projectDto.subSector)

        const req = await this.getCreditRequest(projectDto, constants);
        console.log(typeof(req), req)
        project.numberOfITMO = await calculateCredit(req);
        project.constantVersion = constants ? String(constants.version): "default"
        const endBlock = parseInt(await this.counterService.incrementCount(CounterType.ITMO, 0, project.numberOfITMO))
        project.serialNo = generateSerialNumber(projectDto.countryCodeA2, projectDto.sectoralScope, project.projectId, year, startBlock, endBlock);
        project.status = ProjectStatus.REGISTERED;
        return await this.projectLedger.createProject(project);
    }

    async query(query: QueryDto, abilityCondition: string): Promise<DataListResponseDto> {
        const skip = (query.size * query.page) - query.size;
        const resp = (await this.projectRepo.createQueryBuilder()
            .where(abilityCondition ? abilityCondition : "")
            .skip(skip)
            .take(query.size)
            .getManyAndCount())

        return new DataListResponseDto(
            resp.length > 0 ? resp[0] : undefined,
            resp.length > 1 ? resp[1] : undefined
        );
    }

    async getProjectEvents(projectId: string): Promise<any> {
        const resp = await this.projectLedger.getProjectHistory(projectId);
        return resp == null ? []: resp;
    }

    async updateCustomConstants(customConstantType: SubSector, constants: ConstantUpdateDto) {
        let config;
        if (customConstantType == SubSector.AGRICULTURE) {
            config = new AgricultureConstants()
            const recv = instanceToPlain(constants.agricultureConstants)
            for (const key in recv) {
                if (recv.hasOwnProperty(key) && recv[key] != undefined) {
                    config[key] = recv[key]
                }
            }
        }
        else if (customConstantType == SubSector.SOLAR) {
            config = new SolarConstants()
            const recv = instanceToPlain(constants.solarConstants)
            for (const key in recv) {
                if (recv.hasOwnProperty(key) && recv[key] != undefined) {
                    config[key] = recv[key]
                }
            }
        }

        const existing = await this.getLatestConstant(customConstantType);
        if (existing && JSON.stringify(existing.data) == JSON.stringify(config)) {
            throw new HttpException("Not difference in the config from the previous version", HttpStatus.BAD_REQUEST)
        }
        const resp = await this.constantRepo.save({
            id: customConstantType,
            data: config
        })
        return new DataResponseDto(HttpStatus.OK, resp);
    }

    async getLatestConstant(customConstantType: SubSector) {
        return await this.constantRepo.findOne({
            where: [ {id : customConstantType}],
            order: { version: 'DESC' }
        });
    }

    async updateProjectStatus(req: ProjectApprove, status: ProjectStatus, expectedCurrentStatus: ProjectStatus) {
        this.logger.log(`Project ${req.projectId} status updating to ${status}. Comment: ${req.comment}`)
        return await this.projectLedger.updateProjectStatus(req.projectId, status, expectedCurrentStatus)
    }
}
